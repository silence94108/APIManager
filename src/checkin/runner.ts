import { refreshAccountBalance } from "@/api/balance";
import { listAccounts } from "@/storage/accounts";
import { getCheckinResults, patchSchedulerState, setAccountCheckinRecord } from "@/storage/checkinState";
import { getCheckinSettings } from "@/storage/settings";
import type { Account, ProviderResult } from "@/types";
import { localDayString } from "@/utils/day";
import { getProvider } from "./providers";
import type { RunOutcome, RunSummary } from "./types";

export type RunKind = "daily" | "manual" | "retry";

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
  const all = await listAccounts();
  const targets = accountIds ? all.filter((a) => accountIds.includes(a.id)) : all;
  const today = localDayString();
  const priorResults = await getCheckinResults();

  const summary: RunSummary = { success: 0, already: 0, failed: 0, skipped: 0 };
  const failedIds: string[] = [];

  for (const account of targets) {
    if (account.disabled || !account.checkinEnabled || account.tokenState === "expired") {
      summary.skipped++;
      continue;
    }
    const prior = priorResults[account.id];
    if (prior?.date === today && (prior.status === "success" || prior.status === "already_checked")) {
      summary.already++;
      continue;
    }

    const result = await checkInOne(account);
    await setAccountCheckinRecord(account.id, {
      date: today,
      status: result.status,
      message: result.message,
      at: Date.now(),
    });

    if (result.status === "success") {
      summary.success++;
      // 签到成功顺带刷新余额；刷新失败不影响签到结果
      await refreshAccountBalance(account).catch(() => {});
    } else if (result.status === "already_checked") {
      summary.already++;
    } else if (result.status === "failed") {
      summary.failed++;
      failedIds.push(account.id);
    } else {
      summary.skipped++;
    }
  }

  await patchSchedulerState({ lastRun: { at: Date.now(), kind, summary } });
  await notifyIfEnabled(kind, summary, targets, failedIds);

  return { summary, failedIds };
}

async function checkInOne(account: Account): Promise<ProviderResult> {
  try {
    return await getProvider(account.siteType).checkIn(account);
  } catch (e) {
    return { status: "failed", message: e instanceof Error ? e.message : String(e) };
  }
}

async function notifyIfEnabled(
  kind: RunKind,
  summary: RunSummary,
  targets: Account[],
  failedIds: string[],
): Promise<void> {
  const settings = await getCheckinSettings();
  // 手动单账号操作 UI 上有即时反馈，不再弹系统通知
  if (!settings.notifyOnFinish || kind === "manual") return;
  if (summary.success + summary.failed === 0) return;

  const failedNames = targets
    .filter((a) => failedIds.includes(a.id))
    .map((a) => a.name)
    .join("、");
  const lines = [`成功 ${summary.success} · 已签 ${summary.already} · 失败 ${summary.failed}`];
  if (failedNames) lines.push(`失败：${failedNames}`);

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
