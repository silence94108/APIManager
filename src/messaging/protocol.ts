import { defineExtensionMessaging } from "@webext-core/messaging";
import type { RunOutcome } from "@/checkin/types";

/** UI → background 的 RPC。错误走显式 ok/error 通道，不依赖跨端 Error 序列化 */
interface ProtocolMap {
  refreshBalance(accountId: string): { ok: true; usd: number } | { ok: false; error: string };
  refreshAllBalances(): { done: number; failed: { name: string; error: string }[] };
  runCheckin(input: { accountIds?: string[] }): { ok: true; outcome: RunOutcome } | { ok: false; error: string };
  reschedule(): { nextDailyAt?: number };
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
