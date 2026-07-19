import { useEffect, useState, type ReactNode } from "react";
import { formatRunSummary } from "@/checkin/helpers";
import { sendMessage } from "@/messaging/protocol";
import {
  accountsItem,
  checkinResultsItem,
  checkinSettingsItem,
  schedulerStateItem,
} from "@/storage/items";
import type { CheckinSettings, CheckinStatus } from "@/types";
import { localDayString, parseHm } from "@/utils/day";
import { Badge, Button, cn, Field, Input, Spinner, toast, Toggle } from "@/ui/components";
import { useStorageItem } from "@/ui/hooks";

const STATUS_LABELS: Record<CheckinStatus, { text: string; tone: "phos" | "amber" | "signal" | "mute" }> = {
  success: { text: "成功", tone: "phos" },
  already_checked: { text: "已签", tone: "mute" },
  failed: { text: "失败", tone: "signal" },
  needs_verification: { text: "待验证", tone: "amber" },
};

function fmtTime(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

/** 记录行只显时分秒——列表本身已限定"今日"，日期是冗余 */
function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

type RecordFilter = "all" | "failed" | "needs_verification";

export default function CheckinPage() {
  const [settings, setSettings] = useState<CheckinSettings | null>(null);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<RecordFilter>("all");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const schedulerState = useStorageItem(schedulerStateItem);
  const results = useStorageItem(checkinResultsItem);
  const accounts = useStorageItem(accountsItem);

  useEffect(() => {
    void checkinSettingsItem.getValue().then(setSettings);
  }, []);

  if (!settings) return null;

  async function save() {
    if (!settings) return;
    if ((settings.mode ?? "window") === "fixed") {
      if (parseHm(settings.fixedTime ?? "") === null) {
        toast("固定时刻无效：请填写 HH:mm", "err");
        return;
      }
    } else {
      const start = parseHm(settings.windowStart);
      const end = parseHm(settings.windowEnd);
      if (start === null || end === null || start >= end) {
        toast("时间窗口无效：要求 开始 < 结束（同一天内）", "err");
        return;
      }
    }
    await checkinSettingsItem.setValue(settings);
    const { nextDailyAt } = await sendMessage("reschedule", undefined);
    toast(
      settings.autoEnabled
        ? `已保存，下次自动签到：${fmtTime(nextDailyAt)}`
        : "已保存，自动签到已关闭",
    );
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await sendMessage("runCheckin", {});
      if (res.ok) {
        toast(`签到完成：${formatRunSummary(res.outcome.summary, { withSkipped: true })}`);
      } else {
        toast(res.error, "err");
      }
    } finally {
      setRunning(false);
    }
  }

  async function retryOne(accountId: string, name: string) {
    setRetryingId(accountId);
    try {
      const res = await sendMessage("runCheckin", { accountIds: [accountId] });
      if (!res.ok) {
        toast(res.error, "err");
        return;
      }
      // 结果以存储里本账号的今日记录为准（与 popup 单签同一契约），列表经 useStorageItem 自动刷新
      const record = (await checkinResultsItem.getValue())[accountId];
      if (record?.date === today && record.status === "success") toast(`${name} 重试成功`);
      else toast(`${name} 重试后仍未成功${record?.message ? `：${record.message}` : ""}`, "err");
    } finally {
      setRetryingId(null);
    }
  }

  const today = localDayString();
  const todayRows = (accounts ?? [])
    .map((a) => ({ account: a, record: results?.[a.id] }))
    .filter((r) => r.record?.date === today)
    .sort((a, b) => b.record!.at - a.record!.at);
  const failedCount = todayRows.filter((r) => r.record!.status === "failed").length;
  const verifyCount = todayRows.filter((r) => r.record!.status === "needs_verification").length;
  const visibleRows = filter === "all" ? todayRows : todayRows.filter((r) => r.record!.status === filter);

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="readout mb-4 text-[14px] text-ink">自动签到设置</h2>
        <div className="space-y-4">
          <Toggle
            checked={settings.autoEnabled}
            onChange={(v) => setSettings({ ...settings, autoEnabled: v })}
            label="每日自动签到"
          />
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[12px] text-ink-faint">触发时刻</span>
            <FilterChip
              active={(settings.mode ?? "window") === "window"}
              onClick={() => setSettings({ ...settings, mode: "window" })}
            >
              窗口内随机
            </FilterChip>
            <FilterChip
              active={settings.mode === "fixed"}
              onClick={() => setSettings({ ...settings, mode: "fixed" })}
            >
              每天定时
            </FilterChip>
          </div>
          {settings.mode === "fixed" ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="每天于此时刻签到">
                <Input
                  type="time"
                  value={settings.fixedTime ?? "09:00"}
                  onChange={(e) => setSettings({ ...settings, fixedTime: e.target.value })}
                />
              </Field>
              <p className="self-end pb-1.5 text-[11px] leading-snug text-ink-faint">
                错过时刻（浏览器未开）会在打开后尽快补签
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field label="窗口开始">
                <Input
                  type="time"
                  value={settings.windowStart}
                  onChange={(e) => setSettings({ ...settings, windowStart: e.target.value })}
                />
              </Field>
              <Field label="窗口结束">
                <Input
                  type="time"
                  value={settings.windowEnd}
                  onChange={(e) => setSettings({ ...settings, windowEnd: e.target.value })}
                />
              </Field>
            </div>
          )}
          <Toggle
            checked={settings.retryEnabled}
            onChange={(v) => setSettings({ ...settings, retryEnabled: v })}
            label="失败后重试（30 分钟后，每账号每日最多 3 次尝试）"
          />
          <Toggle
            checked={settings.notifyOnFinish}
            onChange={(v) => setSettings({ ...settings, notifyOnFinish: v })}
            label="完成后发系统通知"
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="phos" onClick={save}>
            保存设置
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="readout text-[14px] text-ink">运行状态</h2>
          <Button variant="phos" disabled={running} onClick={runNow}>
            {running ? <Spinner /> : "⚡ 立即全部签到"}
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-ink-faint">下次自动签到</dt>
            <dd className="readout text-ink">{fmtTime(schedulerState?.nextDailyAt)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-faint">下次失败重试</dt>
            <dd className="readout text-ink">{fmtTime(schedulerState?.nextRetryAt)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-faint">上次运行</dt>
            <dd className="readout text-ink">{fmtTime(schedulerState?.lastRun?.at)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-faint">上次结果</dt>
            <dd className="readout text-ink">
              {schedulerState?.lastRun
                ? `✓${schedulerState.lastRun.summary.success} ·${schedulerState.lastRun.summary.already} ✗${schedulerState.lastRun.summary.failed}${schedulerState.lastRun.summary.needsVerify > 0 ? ` ⚠${schedulerState.lastRun.summary.needsVerify}` : ""}`
                : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="readout text-[14px] text-ink">今日签到记录 · {todayRows.length}</h2>
          {todayRows.length > 0 && (
            <div className="flex gap-1.5">
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
                全部
              </FilterChip>
              <FilterChip active={filter === "failed"} onClick={() => setFilter("failed")} tone="signal">
                失败{failedCount > 0 ? ` ${failedCount}` : ""}
              </FilterChip>
              <FilterChip
                active={filter === "needs_verification"}
                onClick={() => setFilter("needs_verification")}
                tone="amber"
              >
                待验证{verifyCount > 0 ? ` ${verifyCount}` : ""}
              </FilterChip>
            </div>
          )}
        </div>
        {todayRows.length === 0 ? (
          <p className="text-[13px] text-ink-faint">今天还没有签到记录</p>
        ) : visibleRows.length === 0 ? (
          <p className="text-[13px] text-ink-faint">
            {filter === "failed" ? "没有失败记录 ✓" : "没有待验证记录 ✓"}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {visibleRows.map(({ account, record }) => (
              <li
                key={account.id}
                className="flex items-center gap-3 rounded-md border border-line/60 px-3 py-1.5 text-[13px]"
              >
                <span className="readout shrink-0 text-[11px] text-ink-faint">{fmtClock(record!.at)}</span>
                <span className="flex-1 truncate">{account.name}</span>
                <Badge tone={STATUS_LABELS[record!.status].tone}>
                  {STATUS_LABELS[record!.status].text}
                </Badge>
                <span className="max-w-[38%] truncate text-[11px] text-ink-faint" title={record!.message}>
                  {record!.message || ""}
                </span>
                {record!.status === "failed" && (
                  <Button
                    size="sm"
                    disabled={retryingId !== null}
                    onClick={() => void retryOne(account.id, account.name)}
                  >
                    {retryingId === account.id ? <Spinner /> : "↯ 重试"}
                  </Button>
                )}
                {record!.status === "needs_verification" && (
                  <Button size="sm" onClick={() => window.open(account.url)}>
                    ↗ 去站点
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: "signal" | "amber";
  children: ReactNode;
}) {
  const activeTone =
    tone === "signal"
      ? "border-signal/50 text-signal"
      : tone === "amber"
        ? "border-amber/50 text-amber"
        : "border-phos/50 text-phos";
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded border px-2 py-0.5 text-[11px] transition",
        active ? activeTone : "border-line text-ink-faint hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
