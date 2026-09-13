import { patchSchedulerState } from "@/storage/checkinState";
import { accountsItem, checkinCooldownsItem, checkinResultsItem, checkinSettingsItem, schedulerStateItem } from "@/storage/items";
import type { CheckinSettings, SchedulerState } from "@/types";
import { localDayString, parseHm } from "@/utils/day";
import { canCheckin, checkinContext, checkinRetryAt, hasUnavailableCheckin } from "./helpers";
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
 * 计算下一次每日签到的触发时刻。纯函数，random 可注入。
 * window 模式（默认）：今天已跑（lastDailyRunDay=今天）或窗口已过 → 排明天；
 *       否则在 [max(now+60s, 窗口起点), 窗口终点] 内随机。
 * fixed 模式：每天 fixedTime 触发；今天已跑 → 排明天；
 *       错过今天时刻（浏览器当时没开）→ now+60s 尽快补签，不白丢一天。
 */
export function computeDailyFireTime(
  settings: Pick<CheckinSettings, "mode" | "windowStart" | "windowEnd" | "fixedTime">,
  lastDailyRunDay: string | undefined,
  now: Date,
  random: () => number = Math.random,
): number {
  const ranToday = lastDailyRunDay === localDayString(now);

  if (settings.mode === "fixed") {
    const fixedMin = parseHm(settings.fixedTime ?? "") ?? parseHm(FALLBACK_WINDOW.start)!;
    if (ranToday) {
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return atMinutes(tomorrow, fixedMin);
    }
    const todayAt = atMinutes(now, fixedMin);
    return todayAt >= now.getTime() + 60 * 1000 ? todayAt : now.getTime() + 60 * 1000;
  }

  const startMin = parseHm(settings.windowStart) ?? parseHm(FALLBACK_WINDOW.start)!;
  const endMin = parseHm(settings.windowEnd) ?? parseHm(FALLBACK_WINDOW.end)!;

  let base = new Date(now);
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

/** 保证每日闹钟有效，并从持久化队列恢复重试闹钟。 */
export function ensureScheduled(force = false): Promise<void> {
  return serializeSchedule(() => restoreScheduled(force));
}

async function restoreScheduled(force: boolean): Promise<void> {
  const settings = await checkinSettingsItem.getValue();
  if (!settings.autoEnabled) {
    await browser.alarms.clear(DAILY_ALARM);
    await clearRetry();
    await patchSchedulerState({ nextDailyAt: undefined, dailyAlarmTargetDay: undefined });
    return;
  }
  const state = await schedulerStateItem.getValue();
  if (state.retry) await scheduleRetry(state.retry);
  else await clearRetry();
  const existing = await browser.alarms.get(DAILY_ALARM);
  if (force || !existing || existing.scheduledTime <= Date.now()) await scheduleDaily();
}

async function scheduleDaily(): Promise<void> {
  const settings = await checkinSettingsItem.getValue();
  if (!settings.autoEnabled) return;
  const state = await schedulerStateItem.getValue();
  const when = computeDailyFireTime(settings, state.lastDailyRunDay, new Date());
  await browser.alarms.create(DAILY_ALARM, { when });
  await patchSchedulerState({
    nextDailyAt: when,
    dailyAlarmTargetDay: localDayString(new Date(when)),
  });
}

// 启动恢复、设置变更和 alarm 回调串行，避免旧队列覆盖新一轮的结果。
let handling: Promise<void> = Promise.resolve();
function serializeSchedule(action: () => Promise<void>): Promise<void> {
  const task = handling.then(action);
  handling = task.catch(() => {});
  return task;
}

export function handleAlarm(alarm: { name: string }): Promise<void> {
  return serializeSchedule(async () => {
    if (alarm.name === DAILY_ALARM) await handleDailyAlarm();
    if (alarm.name === RETRY_ALARM) await handleRetryAlarm();
  });
}

async function handleDailyAlarm(): Promise<void> {
  if (!(await checkinSettingsItem.getValue()).autoEnabled) return;
  const today = localDayString();
  const state = await schedulerStateItem.getValue();
  if ((state.dailyAlarmTargetDay && state.dailyAlarmTargetDay !== today) || state.lastDailyRunDay === today) {
    await scheduleDaily();
    return;
  }

  await patchSchedulerState({ lastDailyRunDay: today });
  const { retryableIds = [] } = await runCheckin({ kind: "daily" });
  await scheduleRetry({
    day: today, pendingIds: retryableIds,
    attempts: Object.fromEntries(retryableIds.map((id) => [id, 1])),
  });
  await scheduleDaily();
}

type RetryState = NonNullable<SchedulerState["retry"]>;

/** 从最新账号和记录过滤队列，旧版失败记录不默认可重试。 */
async function eligibleRetry(retry: RetryState): Promise<RetryState> {
  const [accounts, results, cooldowns] = await Promise.all([
    accountsItem.getValue(), checkinResultsItem.getValue(), checkinCooldownsItem.getValue(),
  ]);
  const pendingIds: string[] = [];
  const notBefore: Record<string, number> = {};
  for (const id of retry.pendingIds) {
    const account = accounts.find((a) => a.id === id);
    const record = results[id];
    if (!account || !canCheckin(account) || hasUnavailableCheckin(account) ||
      record?.context !== checkinContext(account) || record.date !== retry.day ||
      record.status !== "failed" || record.retryable !== true || record.uncertain ||
      (retry.attempts[id] ?? 1) >= MAX_ATTEMPTS_PER_DAY) continue;
    const when = Math.max(
      retry.notBefore?.[id] ?? 0, record.at + RETRY_DELAY_MS,
      checkinRetryAt(account, record, cooldowns),
    );
    // 限流跨午夜时取消本日重试；站点等待时间仍由 cooldowns 保留给明天。
    if (!Number.isFinite(when) || localDayString(new Date(when)) !== retry.day) continue;
    pendingIds.push(id);
    notBefore[id] = when;
  }
  return { ...retry, pendingIds, notBefore };
}

async function handleRetryAlarm(): Promise<void> {
  const state = await schedulerStateItem.getValue();
  const settings = await checkinSettingsItem.getValue();
  if (!state.retry) return;
  if (!settings.autoEnabled || !settings.retryEnabled || state.retry.day !== localDayString()) {
    await clearRetry();
    return;
  }

  const retry = await eligibleRetry(state.retry);
  const dueIds = retry.pendingIds.filter((id) => retry.notBefore![id] <= Date.now());
  if (dueIds.length === 0) {
    await scheduleRetry(retry);
    return;
  }
  const waitingIds = retry.pendingIds.filter((id) => !dueIds.includes(id));
  const attempts = { ...retry.attempts };
  for (const id of dueIds) attempts[id] = (attempts[id] ?? 1) + 1;
  // 请求之前计次；后台中断后也不能把已开始的尝试当成免费重试。
  await patchSchedulerState({ retry: {
    ...retry, attempts,
    notBefore: { ...retry.notBefore, ...Object.fromEntries(dueIds.map((id) => [id, Date.now() + RETRY_DELAY_MS])) },
  } });
  const { retryableIds = [] } = await runCheckin({ accountIds: dueIds, kind: "retry" });
  const stillFailed = retryableIds.filter((id) => dueIds.includes(id));
  const notBefore = Object.fromEntries(waitingIds.map((id) => [id, retry.notBefore![id]]));
  await scheduleRetry({ day: retry.day, pendingIds: [...waitingIds, ...stillFailed], attempts, notBefore });
}

async function scheduleRetry(candidate: RetryState): Promise<void> {
  const settings = await checkinSettingsItem.getValue();
  if (!settings.autoEnabled || !settings.retryEnabled || candidate.day !== localDayString()) {
    await clearRetry();
    return;
  }
  const retry = await eligibleRetry(candidate);
  if (retry.pendingIds.length === 0) {
    await clearRetry();
    return;
  }
  const when = Math.max(Date.now(), Math.min(...Object.values(retry.notBefore!)));
  // 先记队列，再建闹钟；service worker 中断后 ensureScheduled 可以恢复。
  await patchSchedulerState({ retry, nextRetryAt: when });
  await browser.alarms.create(RETRY_ALARM, { when });
}

async function clearRetry(): Promise<void> {
  await browser.alarms.clear(RETRY_ALARM);
  await patchSchedulerState({ retry: undefined, nextRetryAt: undefined });
}
