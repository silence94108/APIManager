import { useMemo, useRef, useState } from "react";
import {
  fetchFirstApiKey,
  fetchSiteModels,
  groupByVendor,
  nextDelayMs,
  PACING_PRESETS,
  sleep,
  testModel,
  type ModelTestOutcome,
  type PacingKey,
} from "@/api/modelTest";
import { accountsItem, DEFAULT_TEST_MODELS, modelTestSettingsItem } from "@/storage/items";
import { MODEL_TEST_SITE_TYPES, SITE_TYPE_LABELS, type Account } from "@/types";
import { Badge, Button, cn, EmptyState, Input, Select, SiteAvatar, Spinner, toast } from "@/ui/components";
import { useStorageItem } from "@/ui/hooks";

type CellState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; outcome: ModelTestOutcome };

/** account.id::model → 单元格状态 */
type ResultMap = Record<string, CellState>;

const cellKey = (accountId: string, model: string) => `${accountId}::${model}`;

export default function ModelTestPage() {
  const accounts = useStorageItem(accountsItem);
  const settings = useStorageItem(modelTestSettingsItem);

  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [results, setResults] = useState<ResultMap>({});
  const [running, setRunning] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [manualKeyEdit, setManualKeyEdit] = useState<Record<string, string>>({});
  /** 折叠的厂商组（vendor → true 为收起） */
  const [collapsedVendors, setCollapsedVendors] = useState<Record<string, boolean>>({});
  /** 拉取令牌进行中 */
  const [pullingKeys, setPullingKeys] = useState(false);
  /** key 明文可见（accountId → true 为明文） */
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({});
  /** 本轮测试的模型快照——结果表用它，开测后改勾选不影响已出的表 */
  const [ranModels, setRanModels] = useState<string[]>([]);
  /** 拟人停顿的剩余秒数（>0 时 UI 显示"等待中…"） */
  const [waitSec, setWaitSec] = useState(0);
  /** 取消整轮测试的信号 */
  const abortRef = useRef<AbortController | null>(null);

  const testable = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => !a.disabled && MODEL_TEST_SITE_TYPES.includes(a.siteType),
      ),
    [accounts],
  );

  // 必须在提前 return 之前调用——hooks 数量每次渲染要一致
  // 默认预设模型排到目录最前，分组后它们自然落在各厂商组的开头
  const vendorGroups = useMemo(() => {
    const catalog = settings?.models ?? [];
    const defaults = DEFAULT_TEST_MODELS.filter((m) => catalog.includes(m));
    const rest = catalog.filter((m) => !DEFAULT_TEST_MODELS.includes(m));
    return groupByVendor([...defaults, ...rest]);
  }, [settings?.models]);

  if (!accounts || !settings) return null;

  const models = settings.models;
  // selected 缺省（老数据/首次使用）只勾选默认预设那几个；并过滤掉已从目录移除的
  const selectedModels = (settings.selected ?? DEFAULT_TEST_MODELS).filter((m) =>
    models.includes(m),
  );
  // selectedIds 为 null 表示"尚未手动选择"→ 默认全选可测账号
  const selected = selectedIds ?? testable.map((a) => a.id);
  const toggleAccount = (id: string) =>
    setSelectedIds(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    );

  async function persistModelState(nextModels: string[], nextSelected: string[]) {
    await modelTestSettingsItem.setValue({
      ...settings!,
      models: nextModels,
      selected: nextSelected,
    });
  }

  async function addModel() {
    const m = newModel.trim();
    if (!m) return;
    if (models.includes(m)) {
      toast("该模型已在列表中", "err");
      return;
    }
    // 手动添加的模型默认勾选——加它就是为了测它
    await persistModelState([...models, m], [...selectedModels, m]);
    setNewModel("");
  }

  async function removeModel(m: string) {
    await persistModelState(
      models.filter((x) => x !== m),
      selectedModels.filter((x) => x !== m),
    );
  }

  async function toggleModel(m: string) {
    await persistModelState(
      models,
      selectedModels.includes(m)
        ? selectedModels.filter((x) => x !== m)
        : [...selectedModels, m],
    );
  }

  /** 整组勾选/取消：组内全选中则清空该组，否则补齐该组 */
  async function toggleVendorGroup(groupModels: string[]) {
    const allOn = groupModels.every((m) => selectedModels.includes(m));
    await persistModelState(
      models,
      allOn
        ? selectedModels.filter((m) => !groupModels.includes(m))
        : [...new Set([...selectedModels, ...groupModels])],
    );
  }

  async function setPacing(pacing: PacingKey) {
    await modelTestSettingsItem.setValue({ ...settings!, pacing });
  }

  async function pullSiteModels() {
    const targets = testable.filter((a) => selected.includes(a.id));
    if (!targets.length) {
      toast("先选择至少一个账号", "err");
      return;
    }
    const merged = new Set(models);
    let added = 0;
    for (const account of targets) {
      try {
        const list = await fetchSiteModels(account);
        list.forEach((m) => {
          if (!merged.has(m)) added++;
          merged.add(m);
        });
      } catch {
        // 单站失败不阻断
      }
    }
    // 新拉的模型只入目录、不自动勾选——想测哪个自己勾，不用再一个个删
    await persistModelState([...merged], selectedModels);
    toast(added ? `并入 ${added} 个站点模型（默认未勾选）` : "未发现新模型");
  }

  /** 解析账号可用 key：优先手填 → 记忆的手填 → 自动拉；返回 null 时上层露出手填框 */
  async function resolveKey(account: Account): Promise<string | null> {
    const edited = manualKeyEdit[account.id]?.trim();
    if (edited) return edited;
    const remembered = settings!.manualKeys[account.id]?.trim();
    if (remembered) return remembered;
    try {
      return await fetchFirstApiKey(account);
    } catch {
      return null;
    }
  }

  /** 拉取令牌：为选中账号自动拉 API Key 填入手填框，成功后开测会记忆 */
  async function pullTokens() {
    const targets = testable.filter((a) => selected.includes(a.id));
    if (!targets.length) {
      toast("先选择至少一个账号", "err");
      return;
    }
    setPullingKeys(true);
    try {
      let ok = 0;
      const failed: string[] = [];
      for (const account of targets) {
        try {
          const key = await fetchFirstApiKey(account);
          if (key) {
            ok++;
            setManualKeyEdit((prev) => ({ ...prev, [account.id]: key }));
          } else {
            failed.push(`${account.name}（无完整令牌，可能被站点打码，请手填）`);
          }
        } catch (e) {
          failed.push(`${account.name}（${e instanceof Error ? e.message : String(e)}）`);
        }
      }
      if (failed.length) {
        toast(`拉到 ${ok} 个令牌；失败：${failed.join("、")}`, "err");
      } else {
        toast(`拉到 ${ok} 个令牌，已填入下方输入框`);
      }
    } finally {
      setPullingKeys(false);
    }
  }

  /** 拟人停顿：等待随机时长，UI 每秒倒计时；被取消则抛 AbortError */
  async function humanPause(signal: AbortSignal) {
    const total = nextDelayMs(settings!.pacing);
    let remaining = Math.ceil(total / 1000);
    setWaitSec(remaining);
    while (remaining > 0) {
      await sleep(1000, signal);
      remaining -= 1;
      setWaitSec(remaining);
    }
    setWaitSec(0);
  }

  function cancelRun() {
    abortRef.current?.abort();
  }

  async function runTests() {
    const targets = testable.filter((a) => selected.includes(a.id));
    if (!targets.length) {
      toast("先选择至少一个账号", "err");
      return;
    }
    const runModels = selectedModels;
    if (!runModels.length) {
      toast("先勾选至少一个模型", "err");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults({});
    setRanModels(runModels);
    const savedManual: Record<string, string> = {};
    // 展平成 (账号,key,模型) 的任务序列，让拟人停顿均匀落在每次请求之间（含跨账号）
    let firstRequest = true;
    try {
      for (const account of targets) {
        if (controller.signal.aborted) break;
        const key = await resolveKey(account);
        if (!key) {
          // 整行标记为需手填 key（不算真实请求，无需停顿）
          for (const model of runModels) {
            setResults((prev) => ({
              ...prev,
              [cellKey(account.id, model)]: {
                phase: "done",
                outcome: { status: "invalid_key", message: "无法获取 API Key，请手填后重试" },
              },
            }));
          }
          continue;
        }
        if (manualKeyEdit[account.id]?.trim()) savedManual[account.id] = key;
        for (const model of runModels) {
          if (controller.signal.aborted) break;
          // 每次真实请求前拟人停顿（首次除外）——秒级不规律间隔，避免被风控识别为脚本
          if (!firstRequest) {
            try {
              await humanPause(controller.signal);
            } catch (e) {
              if (controller.signal.aborted) break; // 用户取消
              // 非取消的异常不能静默中断整轮——报出来并继续
              toast(`停顿逻辑出错：${e instanceof Error ? e.message : String(e)}`, "err");
            }
          }
          firstRequest = false;
          const ck = cellKey(account.id, model);
          setResults((prev) => ({ ...prev, [ck]: { phase: "running" } }));
          const outcome = await testModel(account.url, key, model);
          setResults((prev) => ({ ...prev, [ck]: { phase: "done", outcome } }));
        }
      }
      if (Object.keys(savedManual).length) {
        await modelTestSettingsItem.setValue({
          ...settings!,
          manualKeys: { ...settings!.manualKeys, ...savedManual },
        });
      }
    } finally {
      setRunning(false);
      setWaitSec(0);
      abortRef.current = null;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="readout mb-1 text-[15px] text-ink">模型测试</h1>
        <p className="text-[12px] text-ink-faint">
          向站点真实发送一条短对话验证模型是否可用——只有真正返回内容才算通过。
          <span className="text-amber">每次测试会消耗少量额度；请求之间会模拟真人节奏随机停顿，避免账号被风控。</span>
          仅支持 New API 系账号（New API / Veloera / AnyRouter）。
        </p>
      </div>

      {testable.length === 0 ? (
        <EmptyState icon="◎" text="没有可测试的账号——请先添加 New API 系账号并启用" />
      ) : (
        <>
          {/* 账号选择 */}
          <section className="space-y-2">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">账号</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {testable.map((account) => {
                const on = selected.includes(account.id);
                return (
                  <button
                    key={account.id}
                    onClick={() => toggleAccount(account.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition",
                      on ? "border-phos/50 bg-phos/5" : "border-line hover:border-ink-faint/40",
                    )}
                  >
                    <SiteAvatar name={account.name} faviconUrl={account.faviconUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{account.name}</p>
                      <p className="readout truncate text-[11px] text-ink-faint">
                        {SITE_TYPE_LABELS[account.siteType]}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 rounded border",
                        on ? "border-phos bg-phos" : "border-line",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {/* 模型选择：按厂商分组，勾选决定测哪些 */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">待测模型</h2>
              <span className="text-[11px] text-ink-faint">
                已勾选 {selectedModels.length} / {models.length}
              </span>
              <button
                onClick={() => void persistModelState(models, [...models])}
                className="text-[11px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
              >
                全选
              </button>
              <button
                onClick={() => void persistModelState(models, [])}
                className="text-[11px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
              >
                全不选
              </button>
            </div>
            <div className="space-y-2">
              {vendorGroups.map((group) => {
                const onCount = group.models.filter((m) => selectedModels.includes(m)).length;
                const allOn = onCount === group.models.length;
                const isCollapsed = collapsedVendors[group.vendor] ?? false;
                return (
                  <div key={group.vendor} className="rounded-lg border border-line p-2.5">
                    <div className={cn("flex items-center gap-2", !isCollapsed && "mb-1.5")}>
                      <button
                        onClick={() => void toggleVendorGroup(group.models)}
                        title={allOn ? "取消整组" : "勾选整组"}
                      >
                        <span
                          className={cn(
                            "block h-3 w-3 shrink-0 rounded border",
                            allOn
                              ? "border-phos bg-phos"
                              : onCount > 0
                                ? "border-phos bg-phos/40"
                                : "border-line",
                          )}
                        />
                      </button>
                      <button
                        onClick={() =>
                          setCollapsedVendors((prev) => ({
                            ...prev,
                            [group.vendor]: !isCollapsed,
                          }))
                        }
                        className="flex flex-1 items-center gap-2 text-left"
                        title={isCollapsed ? "展开" : "收起"}
                      >
                        <span className="text-[12px] text-ink">{group.vendor}</span>
                        <span className="text-[11px] text-ink-faint">
                          {onCount}/{group.models.length}
                        </span>
                        <span className="ml-auto text-[11px] text-ink-faint">
                          {isCollapsed ? "▸" : "▾"}
                        </span>
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="flex flex-wrap gap-1.5">
                        {group.models.map((m) => {
                          const on = selectedModels.includes(m);
                          return (
                            <span
                              key={m}
                              className={cn(
                                "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[12px] transition",
                                on
                                  ? "border-phos/50 bg-phos/10 text-ink"
                                  : "border-line text-ink-faint",
                              )}
                            >
                              <button onClick={() => void toggleModel(m)} title={on ? "取消勾选" : "勾选测试"}>
                                {m}
                              </button>
                              <button
                                onClick={() => void removeModel(m)}
                                className="text-ink-faint hover:text-signal"
                                title="从列表移除"
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addModel()}
                placeholder="添加模型名，如 claude-sonnet-5"
                className="max-w-xs"
              />
              <Button size="sm" onClick={() => void addModel()}>
                添加
              </Button>
              <Button size="sm" onClick={() => void pullSiteModels()}>
                拉取站点模型
              </Button>
              <span className="text-[11px] text-ink-faint">拉取的模型只入列表、默认不勾选</span>
            </div>
          </section>

          {/* 手填 key（自动拉失败时用）*/}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                API Key（自动拉取失败时手填）
              </h2>
              <Button size="sm" disabled={pullingKeys || running} onClick={() => void pullTokens()}>
                {pullingKeys ? <Spinner /> : "拉取令牌"}
              </Button>
              <span className="text-[11px] text-ink-faint">
                自动从选中账号拉第一个可用令牌填入下方
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {testable
                .filter((a) => selected.includes(a.id))
                .map((account) => (
                  <label key={account.id} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-[12px] text-ink-mute">
                      {account.name}
                    </span>
                    <div className="relative flex-1">
                      <Input
                        type={keyVisible[account.id] ? "text" : "password"}
                        value={manualKeyEdit[account.id] ?? ""}
                        onChange={(e) =>
                          setManualKeyEdit((prev) => ({ ...prev, [account.id]: e.target.value }))
                        }
                        placeholder={
                          settings.manualKeys[account.id] ? "已记忆——留空用自动/记忆值" : "留空则自动拉取"
                        }
                        autoComplete="off"
                        className="w-full pr-12"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setKeyVisible((prev) => ({ ...prev, [account.id]: !prev[account.id] }))
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint hover:text-ink"
                      >
                        {keyVisible[account.id] ? "隐藏" : "显示"}
                      </button>
                    </div>
                  </label>
                ))}
            </div>
          </section>

          {/* 测试节奏 */}
          <section className="space-y-2">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">测试节奏</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={settings.pacing ?? "safe"}
                onChange={(e) => void setPacing(e.target.value as PacingKey)}
                disabled={running}
                className="max-w-xs"
              >
                {(Object.keys(PACING_PRESETS) as PacingKey[]).map((k) => (
                  <option key={k} value={k}>
                    {PACING_PRESETS[k].label}
                  </option>
                ))}
              </Select>
              <span className="text-[11px] text-ink-faint">
                请求之间随机停顿，模拟真人节奏——间隔越长越不易触发风控
              </span>
            </div>
          </section>

          <div className="flex items-center gap-3">
            <Button variant="phos" disabled={running} onClick={() => void runTests()}>
              {running ? <Spinner /> : "开始测试"}
            </Button>
            {running && (
              <Button variant="danger" onClick={cancelRun}>
                停止
              </Button>
            )}
            {running && (
              <span className="text-[12px] text-ink-faint">
                {waitSec > 0 ? `拟人等待中，${waitSec}s 后测下一个…` : "测试中，串行进行…"}
              </span>
            )}
          </div>

          {/* 结果表 */}
          {Object.keys(results).length > 0 && (
            <ResultTable
              accounts={testable.filter((a) => selected.includes(a.id))}
              models={ranModels}
              results={results}
            />
          )}
        </>
      )}
    </div>
  );
}

function ResultTable({
  accounts,
  models,
  results,
}: {
  accounts: Account[];
  models: string[];
  results: ResultMap;
}) {
  return (
    <section className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-ink-faint">
            <th className="px-3 py-2 font-normal">模型 \ 账号</th>
            {accounts.map((a) => (
              <th key={a.id} className="px-3 py-2 font-normal">
                {a.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr key={model} className="border-b border-line/50 last:border-0">
              <td className="readout px-3 py-2 align-top text-ink-mute">{model}</td>
              {accounts.map((a) => (
                <td key={a.id} className="px-3 py-2 align-top">
                  <ResultCell state={results[cellKey(a.id, model)]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ResultCell({ state }: { state?: CellState }) {
  if (!state || state.phase === "idle") return <span className="text-ink-faint">—</span>;
  if (state.phase === "running") return <Spinner className="h-3 w-3" />;

  const { outcome } = state;
  const label: Record<Exclude<ModelTestOutcome["status"], "ok">, string> = {
    invalid_key: "Key 无效",
    no_model: "无此模型",
    rate_limited: "限流",
    failed: "失败",
  };
  return (
    <div className="min-w-[200px] max-w-[320px] space-y-1">
      {outcome.status === "ok" ? (
        <Badge tone="phos">✓ {outcome.latencyMs}ms</Badge>
      ) : (
        <Badge tone={outcome.status === "rate_limited" ? "amber" : "signal"}>
          ✗ {label[outcome.status]}
        </Badge>
      )}
      {outcome.prompt && (
        <p className="text-[11px] leading-snug text-ink-faint">问：{outcome.prompt}</p>
      )}
      {outcome.message && (
        <p className="text-[11px] leading-snug text-ink-mute">
          {outcome.status === "ok" ? `答：${outcome.message}` : outcome.message}
        </p>
      )}
    </div>
  );
}
