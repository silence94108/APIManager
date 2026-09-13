import { siteFetch } from "@/api/transport";
import { getAccount, patchAccount } from "@/storage/accounts";
import type { Account, ProviderResult } from "@/types";
import type { CheckinProvider } from "../types";
import { executeStatusFirst, invalidCheckinStatus, readCheckinStatus } from "../execution";
import { sameCheckinAccount } from "../helpers";
import { checkinFailure, resultFromSuccessMessage } from "./shared";

interface VoApiEnvelope {
  code?: number;
  msg?: string;
  data?: unknown;
}

interface CheckinStatsEnvelope {
  code?: number;
  msg?: string;
  data?: { todaySigned?: boolean };
}

const ALREADY_RE = /signed|check/i;
const AUTH_EXPIRED_RE = /auth\s*expire|unauthorized|token|jwt|login/i;

async function markExpired(account: Account): Promise<void> {
  const current = await getAccount(account.id);
  if (current && sameCheckinAccount(account, current)) await patchAccount(account.id, { tokenState: "expired" });
}

function authExpired(): ProviderResult {
  return checkinFailure("authentication", "Token 已过期，请在账号编辑中更新 JWT");
}

/** VoAPI v2：raw JWT 鉴权（无 Bearer 前缀），JWT 会过期——过期标记账号并等用户手动更新 */
export const voapiV2Provider: CheckinProvider = {
  async checkIn(account: Account, options): Promise<ProviderResult> {
    const observe = () => readCheckinStatus<CheckinStatsEnvelope>(account, "/api/check_in/stats", (res) => {
      if (res?.code === 2 && AUTH_EXPIRED_RE.test(res.msg ?? "")) return { blocked: authExpired() };
      if (res?.code !== 0) return invalidCheckinStatus();
      const checked = res.data?.todaySigned;
      return typeof checked === "boolean" ? { checked } : invalidCheckinStatus();
    }, { rawToken: true });
    const result = await executeStatusFirst(observe, async () => {
      const res = await siteFetch<VoApiEnvelope>(account, "/api/check_in", {
        method: "POST",
        rawToken: true,
      });
      const msg = typeof res?.msg === "string" ? res.msg : "";

      if (res?.code === 1 && ALREADY_RE.test(msg)) {
        return { status: "already_checked", message: msg };
      }
      if (res?.code === 2 && AUTH_EXPIRED_RE.test(msg)) return authExpired();
      if (res?.code === 0) return { status: "success", message: msg };
      return resultFromSuccessMessage(typeof res?.code === "number" ? false : undefined, msg);
    }, options, true, account.url + "/api/check_in");
    if (result.reason === "authentication") {
      try {
        await markExpired(account);
      } catch {
        return checkinFailure("storage", "Token 已失效，但过期标记保存失败，请重新编辑账号");
      }
      return authExpired();
    }
    return result;
  },
};
