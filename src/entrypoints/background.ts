import { refreshAccountBalance } from "@/api/balance";
import { ensureScheduled, handleAlarm } from "@/checkin/scheduler";
import { runCheckin } from "@/checkin/runner";
import { onMessage } from "@/messaging/protocol";
import { getAccount, listAccounts } from "@/storage/accounts";
import { getSchedulerState } from "@/storage/checkinState";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => void ensureScheduled());
  // Chrome 重启会清空 alarms，启动时必须重排
  browser.runtime.onStartup.addListener(() => void ensureScheduled());
  browser.alarms.onAlarm.addListener((alarm) => void handleAlarm(alarm));

  onMessage("refreshBalance", async ({ data: accountId }) => {
    const account = await getAccount(accountId);
    if (!account) return { ok: false as const, error: "账号不存在" };
    try {
      return { ok: true as const, usd: await refreshAccountBalance(account) };
    } catch (e) {
      return { ok: false as const, error: errorText(e) };
    }
  });

  onMessage("refreshAllBalances", async () => {
    const accounts = (await listAccounts()).filter((a) => !a.disabled);
    let done = 0;
    const failed: { name: string; error: string }[] = [];
    for (const account of accounts) {
      try {
        await refreshAccountBalance(account);
        done++;
      } catch (e) {
        failed.push({ name: account.name, error: errorText(e) });
      }
    }
    return { done, failed };
  });

  onMessage("runCheckin", async ({ data }) => {
    try {
      const outcome = await runCheckin({ accountIds: data.accountIds, kind: "manual" });
      return { ok: true as const, outcome };
    } catch (e) {
      return { ok: false as const, error: errorText(e) };
    }
  });

  onMessage("reschedule", async () => {
    await ensureScheduled(true);
    const state = await getSchedulerState();
    return { nextDailyAt: state.nextDailyAt };
  });

  void ensureScheduled();
});
