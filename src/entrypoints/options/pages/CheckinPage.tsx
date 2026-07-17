import { useEffect, useState } from "react";
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
import { Badge, Button, Field, Input, Spinner, toast, Toggle } from "@/ui/components";
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

export default function CheckinPage() {
  const [settings, setSettings] = useState<CheckinSettings | null>(null);
  const [running, setRunning] = useState(false);
  const schedulerState = useStorageItem(schedulerStateItem);
  const results = useStorageItem(checkinResultsItem);
  const accounts = useStorageItem(accountsItem);

  useEffect(() => {
    void checkinSettingsItem.getValue().then(setSettings);
  }, []);

  if (!settings) return null;

  async function save() {
    if (!settings) return;
    const start = parseHm(settings.windowStart);
    const end = parseHm(settings.windowEnd);
    if (start === null || end === null || start >= end) {
      toast("时间窗口无效：要求 开始 < 结束（同一天内）", "err");
      return;
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

  const today = localDayString();
  const todayRows = (accounts ?? [])
    .map((a) => ({ account: a, record: results?.[a.id] }))
    .filter((r) => r.record?.date === today);

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="readout mb-4 text-[14px] text-ink">自动签到设置</h2>
        <div className="space-y-4">
          <Toggle
            checked={settings.autoEnabled}
            onChange={(v) => setSettings({ ...settings, autoEnabled: v })}
            label="每日自动签到（在时间窗口内随机时刻执行）"
          />
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
        <h2 className="readout mb-3 text-[14px] text-ink">今日签到记录 · {todayRows.length}</h2>
        {todayRows.length === 0 ? (
          <p className="text-[13px] text-ink-faint">今天还没有签到记录</p>
        ) : (
          <ul className="space-y-1.5">
            {todayRows.map(({ account, record }) => (
              <li
                key={account.id}
                className="flex items-center gap-3 rounded-md border border-line/60 px-3 py-1.5 text-[13px]"
              >
                <span className="flex-1 truncate">{account.name}</span>
                <Badge tone={STATUS_LABELS[record!.status].tone}>
                  {STATUS_LABELS[record!.status].text}
                </Badge>
                <span className="max-w-[45%] truncate text-[11px] text-ink-faint" title={record!.message}>
                  {record!.message || ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
