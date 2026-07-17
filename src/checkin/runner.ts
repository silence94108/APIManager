import { refreshAccountBalance } from "@/api/balance";
import { patchSchedulerState } from "@/storage/checkinState";
import { accountsItem, checkinResultsItem, checkinSettingsItem } from "@/storage/items";
import type { Account, ProviderResult, RunKind, RunOutcome, RunSummary } from "@/types";
import { localDayString } from "@/utils/day";
import { canCheckin, formatRunSummary, isCheckedToday } from "./helpers";
import { getProvider } from "./providers";
import { failedFromError } from "./providers/shared";

interface RunOptions {
  accountIds?: string[];
  kind: RunKind;
}

/** 互斥锁：daily 闹钟与手动触发重叠时复用进行中的执行 */
let running: Promise<RunOutcome> | null = null;

export function runCheckin(options: RunOptions): Promise<RunOutcome> {
  if (running) return running;
  running = doRun(options).finally(() => {
    running = null;
  });
  return running;
}

async function doRun({ accountIds, kind }: RunOptions): Promise<RunOutcome> {
  const all = await accountsItem.getValue();
  const targets = accountIds ? all.filter((a) => accountIds.includes(a.id)) : all;
  const today = localDayString();
  let results = await checkinResultsItem.getValue();

  const summary: RunSummary = { success: 0, already: 0, failed: 0, skipped: 0, needsVerify: 0 };
  const failedIds: string[] = [];
  const verifyIds: string[] = [];

  for (const account of targets) {
    if (!canCheckin(account)) {
      summary.skipped++;
      continue;
    }
    if (isCheckedToday(results[account.id], today)) {
      summary.already++;
      continue;
    }

    const result = await checkInOne(account);
    // 逐账号落盘：service worker 中途被杀也能保住已完成账号的记录
    results = {
      ...results,
      [account.id]: { date: today, status: result.status, message: result.message, at: Date.now() },
    };
    await checkinResultsItem.setValue(results);

    if (result.status === "success") {
      summary.success++;
      // 签到成功顺带刷新余额；刷新失败不影响签到结果
      await refreshAccountBalance(account).catch(() => {});
    } else if (result.status === "already_checked") {
      summary.already++;
    } else if (result.status === "needs_verification") {
      // 需用户到站点完成人机验证：不计失败、不进重试队列（重试也过不了）
      summary.needsVerify++;
      verifyIds.push(account.id);
    } else {
      summary.failed++;
      failedIds.push(account.id);
    }
  }

  await patchSchedulerState({ lastRun: { at: Date.now(), kind, summary } });
  await notifyIfEnabled(kind, summary, targets, failedIds, verifyIds);

  return { summary, failedIds };
}

async function checkInOne(account: Account): Promise<ProviderResult> {
  try {
    return await getProvider(account.siteType).checkIn(account);
  } catch (e) {
    return failedFromError(e);
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
