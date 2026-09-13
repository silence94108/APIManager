import { refreshAccountBalance } from "@/api/balance";
import { getAccount } from "@/storage/accounts";
import { patchSchedulerState } from "@/storage/checkinState";
import { accountsItem, checkinCooldownsItem, checkinResultsItem, checkinSettingsItem } from "@/storage/items";
import type { Account, ProviderResult, RunKind, RunOutcome, RunSummary } from "@/types";
import { localDayString } from "@/utils/day";
import {
  canCheckin, checkinContext, checkinRetryAt, currentCheckinRecord, formatRunSummary,
  hasUnavailableCheckin, isCheckedToday, sameCheckinAccount,
} from "./helpers";
import { getProvider } from "./providers";
import { checkinFailure, failedFromError, uncertainCheckin } from "./providers/shared";
import { assistTurnstileCheckin } from "./turnstileAssist";
import type { CheckinExecutionOptions } from "./types";

interface RunOptions {
  accountIds?: string[];
  kind: RunKind;
}

/** 串行执行各轮请求；不同手动操作和闹钟分别获取自己的结果。 */
let running: Promise<void> = Promise.resolve();

export function runCheckin(options: RunOptions): Promise<RunOutcome> {
  const task = running.then(() => doRun(options));
  running = task.then(() => {}, () => {});
  return task;
}

async function doRun({ accountIds, kind }: RunOptions): Promise<RunOutcome> {
  const all = await accountsItem.getValue();
  const targets = accountIds ? all.filter((a) => accountIds.includes(a.id)) : all;
  const today = localDayString();
  const summary: RunSummary = { success: 0, already: 0, failed: 0, skipped: 0, needsVerify: 0 };
  const failedIds: string[] = [];
  const retryableIds: string[] = [];
  const verifyIds: string[] = [];

  for (const target of targets) {
    // 每个账号开始前重新读取，不能使用整轮开始时的旧开关或旧凭据。
    const account = await getAccount(target.id);
    const settings = await checkinSettingsItem.getValue();
    if (!account || localDayString() !== today || !canCheckin(account) ||
      (kind !== "manual" && (!settings.autoEnabled || hasUnavailableCheckin(account)))) {
      summary.skipped++;
      continue;
    }
    const record = currentCheckinRecord(account, (await checkinResultsItem.getValue())[account.id]);
    if (isCheckedToday(record, today)) {
      summary.already++;
      continue;
    }
    if (kind === "retry" && (record?.date !== today || record.status !== "failed" ||
      record.retryable !== true || record.uncertain)) {
      summary.skipped++;
      continue;
    }

    const reconcileOnly = record?.date === today && record.uncertain === true;
    let prepared = false;
    const options: CheckinExecutionOptions = {
      reconcileOnly,
      beforeSubmit: async () => {
        const current = await getAccount(account.id);
        const latestSettings = await checkinSettingsItem.getValue();
        const latestResults = await checkinResultsItem.getValue();
        const currentRecord = currentCheckinRecord(account, latestResults[account.id]);
        const cooldowns = await checkinCooldownsItem.getValue();
        if (!current || !canCheckin(current) || !sameCheckinAccount(account, current) ||
          localDayString() !== today || reconcileOnly ||
          (kind !== "manual" && (!latestSettings.autoEnabled || hasUnavailableCheckin(current))) ||
          isCheckedToday(currentRecord, today) ||
          (currentRecord?.date === today && currentRecord.uncertain && !prepared) ||
          checkinRetryAt(account, currentRecord, cooldowns) > Date.now()) {
          throw new Error("账号或签到状态已变化");
        }
        // 先持久化再写请求；后台进程在任意后续时刻退出，下次也只能查询。
        await checkinResultsItem.setValue({
          ...latestResults,
          [account.id]: {
            ...uncertainCheckin("签到请求已准备提交，正在等待站点确认"),
            date: today, context: checkinContext(account), at: Date.now(),
          },
        });
        prepared = true;
        // 落盘过程中用户可能编辑/禁用账号，再核对一次。
        const afterSave = await getAccount(account.id);
        if (!afterSave || !canCheckin(afterSave) || !sameCheckinAccount(account, afterSave)) {
          throw new Error("账号已变化");
        }
      },
    };

    const retryAt = checkinRetryAt(account, record, await checkinCooldownsItem.getValue());
    let result: ProviderResult;
    if (retryAt > Date.now()) {
      result = {
        ...(reconcileOnly ? uncertainCheckin() : checkinFailure("rate_limited", "站点限流等待中", true)),
        retryAt,
        message: `站点要求等待至 ${new Date(retryAt).toLocaleString("zh-CN", { hour12: false })} 后再${reconcileOnly ? "核对状态" : "尝试"}`,
      };
    } else {
      result = await checkInOne(account, options);
      if (result.status === "needs_verification" && !result.uncertain && !reconcileOnly &&
        (settings.turnstileAssist ?? true)) {
        result = (await assistTurnstileCheckin(account, options)) ?? result;
      }
    }

    try {
      await rememberCooldown(account, result.retryAt);
      await saveResult(account, today, result);
    } catch {
      // 提交前的待确认记录保留；持久化失败不进入重试队列。
      result = {
        ...checkinFailure("storage", "签到结果无法完整保存，请核对站点状态后再操作"),
        uncertain: prepared || reconcileOnly || result.uncertain,
      };
    }

    if (result.status === "success") {
      summary.success++;
      const current = await getAccount(account.id);
      if (current && !current.disabled && sameCheckinAccount(account, current)) {
        await refreshAccountBalance(current).catch(() => {});
      }
    } else if (result.status === "already_checked") {
      summary.already++;
    } else if (result.status === "needs_verification") {
      summary.needsVerify++;
      verifyIds.push(account.id);
    } else {
      summary.failed++;
      failedIds.push(account.id);
      if (result.retryable === true && !result.uncertain) retryableIds.push(account.id);
    }
  }

  await patchSchedulerState({ lastRun: { at: Date.now(), kind, summary } });
  await notifyIfEnabled(kind, summary, targets, failedIds, verifyIds);
  return { summary, failedIds, retryableIds };
}

async function rememberCooldown(account: Account, at?: number): Promise<void> {
  if (typeof at !== "number" || !Number.isFinite(at) || at <= Date.now()) return;
  const current = await checkinCooldownsItem.getValue();
  const active = Object.fromEntries(Object.entries(current).filter(([, until]) => until > Date.now()));
  await checkinCooldownsItem.setValue({ ...active, [account.url]: Math.max(active[account.url] ?? 0, at) });
}

async function saveResult(account: Account, date: string, result: ProviderResult): Promise<void> {
  const current = await getAccount(account.id);
  // 删除、换号或改凭据之后，不把旧请求结果写到新账号上。
  if (!current || !sameCheckinAccount(account, current)) return;
  const { capability, ...record } = result;
  const latest = await checkinResultsItem.getValue();
  await checkinResultsItem.setValue({
    ...latest,
    [account.id]: { ...record, date, context: checkinContext(account), at: Date.now() },
  });
  if (capability) {
    const accounts = await accountsItem.getValue();
    const target = accounts.find((a) => a.id === account.id);
    if (!target || !sameCheckinAccount(account, target)) return;
    await accountsItem.setValue(accounts.map((a) => a.id === account.id ? {
      ...a,
      checkinCapability: { state: capability, context: checkinContext(account), at: Date.now(), message: result.message },
    } : a));
  }
}

async function checkInOne(account: Account, options: CheckinExecutionOptions): Promise<ProviderResult> {
  try {
    return await getProvider(account.siteType).checkIn(account, options);
  } catch (error) {
    return options.reconcileOnly ? uncertainCheckin() : failedFromError(error);
  }
}

async function notifyIfEnabled(
  kind: RunKind,
  summary: RunSummary,
  targets: Account[],
  failedIds: string[],
  verifyIds: string[],
): Promise<void> {
  const settings = await checkinSettingsItem.getValue();
  // 手动单账号操作 UI 上有即时反馈，不再弹系统通知
  if (!settings.notifyOnFinish || kind === "manual") return;
  if (summary.success + summary.failed + summary.needsVerify === 0) return;

  const failedNames = targets
    .filter((a) => failedIds.includes(a.id))
    .map((a) => a.name)
    .join("、");
  const lines = [formatRunSummary(summary)];
  if (failedNames) lines.push(`失败：${failedNames}`);
  const verifyNames = targets
    .filter((a) => verifyIds.includes(a.id))
    .map((a) => a.name)
    .join("、");
  if (verifyNames) lines.push(`待验证：${verifyNames}`);

  try {
    await browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("/icon/128.png"),
      title: kind === "retry" ? "APIManager 签到重试完成" : "APIManager 自动签到完成",
      message: lines.join("\n"),
    });
  } catch {
    // 通知失败不影响签到流程
  }
}
