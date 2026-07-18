import { refreshAccountBalance, refreshBalances } from "@/api/balance";
import { ensureScheduled, handleAlarm } from "@/checkin/scheduler";
import { runCheckin } from "@/checkin/runner";
import { onMessage } from "@/messaging/protocol";
import { getAccount } from "@/storage/accounts";
import { accountsItem, schedulerStateItem } from "@/storage/items";
import { BALANCE_SITE_TYPES } from "@/types";

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
    // 无余额接口（other）或仅凭证账号（token 模式未填 token）不参与批量刷新
    const accounts = (await accountsItem.getValue()).filter(
      (a) =>
        !a.disabled &&
        BALANCE_SITE_TYPES.includes(a.siteType) &&
        (a.authType !== "token" || a.accessToken),
    );
    return refreshBalances(accounts);
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
    const state = await schedulerStateItem.getValue();
    return { nextDailyAt: state.nextDailyAt };
  });

  void ensureScheduled();
});
