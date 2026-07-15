import { patchSchedulerState } from "@/storage/checkinState";
import { checkinSettingsItem, schedulerStateItem } from "@/storage/items";
import type { CheckinSettings } from "@/types";
import { localDayString, parseHm } from "@/utils/day";
import { runCheckin } from "./runner";

export const DAILY_ALARM = "checkin:daily";
export const RETRY_ALARM = "checkin:retry";

const RETRY_DELAY_MS = 30 * 60 * 1000;
/** 首次失败 + 最多 2 次重试 */
const MAX_ATTEMPTS_PER_DAY = 3;
const FALLBACK_WINDOW = { start: "09:00", end: "21:00" };

function atMinutes(base: Date, minutes: number): number {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  return d.getTime() + minutes * 60 * 1000;
}

/**
 * 计算下一次每日签到的触发时刻（窗口内均匀随机）。纯函数，random 可注入。
 * 规则：今天已跑（lastDailyRunDay=今天）或窗口已过 → 排明天；
 *       否则在 [max(now+60s, 窗口起点), 窗口终点] 内随机。
 */
export function computeDailyFireTime(
  settings: Pick<CheckinSettings, "windowStart" | "windowEnd">,
  lastDailyRunDay: string | undefined,
  now: Date,
  random: () => number = Math.random,
): number {
  const startMin = parseHm(settings.windowStart) ?? parseHm(FALLBACK_WINDOW.start)!;
  const endMin = parseHm(settings.windowEnd) ?? parseHm(FALLBACK_WINDOW.end)!;

  let base = new Date(now);
  const ranToday = lastDailyRunDay === localDayString(now);
  const todayWindowEnd = atMinutes(now, endMin);
  if (ranToday || now.getTime() >= todayWindowEnd) {
    base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  }

  const windowStart = atMinutes(base, startMin);
  const windowEnd = atMinutes(base, endMin);
  const lower = Math.max(now.getTime() + 60 * 1000, windowStart);
  if (lower >= windowEnd) {
    // 边界兜底：随机下限已越过窗口终点（如 now 恰在窗口尾），顺延一天
    const nextDay = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1);
    const s = atMinutes(nextDay, startMin);
    const e = atMinutes(nextDay, endMin);
    return Math.floor(s + random() * (e - s));
  }
  return Math.floor(lower + random() * (windowEnd - lower));
}

/** 保证有一个有效的每日闹钟。force=true 时强制重排（设置变更后用） */
export async function ensureScheduled(force = false): Promise<void> {
  const settings = await checkinSettingsItem.getValue();
  if (!settings.autoEnabled) {
    await browser.alarms.clear(DAILY_ALARM);
    await browser.alarms.clear(RETRY_ALARM);
    await patchSchedulerState({
      nextDailyAt: undefined,
      nextRetryAt: undefined,
      dailyAlarmTargetDay: undefined,
      retry: undefined,
    });
    return;
  }
  if (!force) {
    const existing = await browser.alarms.get(DAILY_ALARM);
    if (existing && existing.scheduledTime > Date.now()) return;
  }
  await scheduleDaily();
}

async function scheduleDaily(): Promise<void> {
  const settings = await checkinSettingsItem.getValue();
  const state = await schedulerStateItem.getValue();
  const when = computeDailyFireTime(settings, state.lastDailyRunDay, new Date());
  browser.alarms.create(DAILY_ALARM, { when });
  await patchSchedulerState({
    nextDailyAt: when,
    dailyAlarmTargetDay: localDayString(new Date(when)),
  });
}

export async function handleAlarm(alarm: { name: string }): Promise<void> {
  if (alarm.name === DAILY_ALARM) return handleDailyAlarm();
  if (alarm.name === RETRY_ALARM) return handleRetryAlarm();
}

async function handleDailyAlarm(): Promise<void> {
  const today = localDayString();
  const state = await schedulerStateItem.getValue();

  // 休眠跨天后触发的陈旧闹钟：目标日已过，丢弃并重排
  if (state.dailyAlarmTargetDay && state.dailyAlarmTargetDay !== today) {
    await scheduleDaily();
    return;
  }
  if (state.lastDailyRunDay === today) {
    await scheduleDaily();
    return;
  }

  await patchSchedulerState({ lastDailyRunDay: today });
  const { failedIds } = await runCheckin({ kind: "daily" });
  await maybeScheduleRetry(today, failedIds, {});
  await scheduleDaily();
}

async function handleRetryAlarm(): Promise<void> {
  const state = await schedulerStateItem.getValue();
  const retry = state.retry;
  if (!retry) return;

  const today = localDayString();
  if (retry.day !== today) {
    // 重试绝不跨天
    await clearRetry();
    return;
  }

  const { failedIds } = await runCheckin({ accountIds: retry.pendingIds, kind: "retry" });
  await maybeScheduleRetry(today, failedIds, retry.attempts);
}

async function maybeScheduleRetry(
  day: string,
  failedIds: string[],
  prevAttempts: Record<string, number>,
): Promise<void> {
  const settings = await checkinSettingsItem.getValue();
  if (!settings.retryEnabled || failedIds.length === 0) {
    await clearRetry();
    return;
  }

  const attempts: Record<string, number> = { ...prevAttempts };
  for (const id of failedIds) attempts[id] = (attempts[id] ?? 0) + 1;
  const pendingIds = failedIds.filter((id) => attempts[id] < MAX_ATTEMPTS_PER_DAY);

  if (pendingIds.length === 0) {
    await clearRetry();
    return;
  }

  const when = Date.now() + RETRY_DELAY_MS;
  browser.alarms.create(RETRY_ALARM, { when });
  await patchSchedulerState({ retry: { day, pendingIds, attempts }, nextRetryAt: when });
}

async function clearRetry(): Promise<void> {
  await browser.alarms.clear(RETRY_ALARM);
  await patchSchedulerState({ retry: undefined, nextRetryAt: undefined });
}
