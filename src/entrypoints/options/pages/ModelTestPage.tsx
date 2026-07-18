import { useMemo, useState } from "react";
import {
  fetchFirstApiKey,
  fetchSiteModels,
  testModel,
  type ModelTestOutcome,
} from "@/api/modelTest";
import { accountsItem, modelTestSettingsItem } from "@/storage/items";
import { MODEL_TEST_SITE_TYPES, SITE_TYPE_LABELS, type Account } from "@/types";
import { Badge, Button, cn, EmptyState, Input, SiteAvatar, Spinner, toast } from "@/ui/components";
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

  const testable = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => !a.disabled && MODEL_TEST_SITE_TYPES.includes(a.siteType),
      ),
    [accounts],
  );

  if (!accounts || !settings) return null;

  const models = settings.models;
  // selectedIds 为 null 表示"尚未手动选择"→ 默认全选可测账号
  const selected = selectedIds ?? testable.map((a) => a.id);
  const toggleAccount = (id: string) =>
    setSelectedIds(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    );

  async function persistModels(next: string[]) {
    await modelTestSettingsItem.setValue({ ...settings!, models: next });
  }

  async function addModel() {
    const m = newModel.trim();
    if (!m) return;
    if (models.includes(m)) {
      toast("该模型已在列表中", "err");
      return;
    }
    await persistModels([...models, m]);
    setNewModel("");
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
    await persistModels([...merged]);
    toast(added ? `并入 ${added} 个站点模型` : "未发现新模型");
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

  async function runTests() {
    const targets = testable.filter((a) => selected.includes(a.id));
    if (!targets.length) {
      toast("先选择至少一个账号", "err");
      return;
    }
    if (!models.length) {
      toast("先添加至少一个模型", "err");
      return;
    }
    setRunning(true);
    setResults({});
    const savedManual: Record<string, string> = {};
    try {
      for (const account of targets) {
        const key = await resolveKey(account);
        if (!key) {
          // 整行标记为需手填 key
          for (const model of models) {
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
        // 手填成功的 key 记忆下来
        if (manualKeyEdit[account.id]?.trim()) savedManual[account.id] = key;
        // 串行逐模型，避免瞬时并发触发站点频控
        for (const model of models) {
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
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="readout mb-1 text-[15px] text-ink">模型测试</h1>
        <p className="text-[12px] text-ink-faint">
          向站点真实发送一条短对话验证模型是否可用——只有真正返回内容才算通过。
          <span className="text-amber">每次测试会消耗少量额度。</span>
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

          {/* 模型选择 */}
          <section className="space-y-2">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">待测模型</h2>
            <div className="flex flex-wrap gap-1.5">
              {models.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 rounded border border-line px-2 py-0.5 text-[12px] text-ink-mute"
                >
                  {m}
                  <button
                    onClick={() => void persistModels(models.filter((x) => x !== m))}
                    className="text-ink-faint hover:text-signal"
                    title="移除"
                  >
                    ×
                  </button>
                </span>
              ))}
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
            </div>
          </section>

          {/* 手填 key（自动拉失败时用）*/}
          <section className="space-y-2">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              API Key（自动拉取失败时手填）
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {testable
                .filter((a) => selected.includes(a.id))
                .map((account) => (
                  <label key={account.id} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-[12px] text-ink-mute">
                      {account.name}
                    </span>
                    <Input
                      type="password"
                      value={manualKeyEdit[account.id] ?? ""}
                      onChange={(e) =>
                        setManualKeyEdit((prev) => ({ ...prev, [account.id]: e.target.value }))
                      }
                      placeholder={
                        settings.manualKeys[account.id] ? "已记忆——留空用自动/记忆值" : "留空则自动拉取"
                      }
                      autoComplete="off"
                    />
                  </label>
                ))}
            </div>
          </section>

          <div className="flex items-center gap-3">
            <Button variant="phos" disabled={running} onClick={() => void runTests()}>
              {running ? <Spinner /> : "开始测试"}
            </Button>
            {running && <span className="text-[12px] text-ink-faint">测试中，串行进行…</span>}
          </div>

          {/* 结果表 */}
          {Object.keys(results).length > 0 && (
            <ResultTable
              accounts={testable.filter((a) => selected.includes(a.id))}
              models={models}
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
              <td className="readout px-3 py-2 text-ink-mute">{model}</td>
              {accounts.map((a) => (
                <td key={a.id} className="px-3 py-2">
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
  if (outcome.status === "ok") {
    return (
      <span className="flex items-center gap-1.5" title={outcome.message}>
        <Badge tone="phos">✓ {outcome.latencyMs}ms</Badge>
      </span>
    );
  }
  const label: Record<Exclude<ModelTestOutcome["status"], "ok">, string> = {
    invalid_key: "Key 无效",
    no_model: "无此模型",
    rate_limited: "限流",
    failed: "失败",
  };
  return (
    <span title={outcome.message}>
      <Badge tone={outcome.status === "rate_limited" ? "amber" : "signal"}>
        ✗ {label[outcome.status]}
      </Badge>
    </span>
  );
}
