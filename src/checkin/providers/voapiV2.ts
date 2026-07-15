import { ApiError, siteFetch } from "@/api/transport";
import { patchAccount } from "@/storage/accounts";
import type { Account, ProviderResult } from "@/types";
import type { CheckinProvider } from "../types";
import { failedFromError } from "./shared";

interface VoApiEnvelope {
  code?: number;
  msg?: string;
  data?: unknown;
}

interface CheckinStatsEnvelope {
  code?: number;
  data?: { todaySigned?: boolean };
}

const ALREADY_RE = /signed|check/i;
const AUTH_EXPIRED_RE = /auth\s*expire|unauthorized|token|jwt|login/i;

async function markExpired(account: Account): Promise<void> {
  await patchAccount(account.id, { tokenState: "expired" });
}

async function queryVoapiCheckedToday(account: Account): Promise<boolean | undefined> {
  try {
    const res = await siteFetch<CheckinStatsEnvelope>(account, "/api/check_in/stats", {
      rawToken: true,
    });
    const signed = res.data?.todaySigned;
    return typeof signed === "boolean" ? signed : undefined;
  } catch {
    return undefined;
  }
}

/** VoAPI v2：raw JWT 鉴权（无 Bearer 前缀），JWT 会过期——过期标记账号并等用户手动更新 */
export const voapiV2Provider: CheckinProvider = {
  async checkIn(account: Account): Promise<ProviderResult> {
    try {
      const res = await siteFetch<VoApiEnvelope>(account, "/api/check_in", {
        method: "POST",
        rawToken: true,
      });
      const msg = res.msg ?? "";

      if (res.code === 1 && ALREADY_RE.test(msg)) {
        return { status: "already_checked", message: msg };
      }
      if (res.code === 2 && AUTH_EXPIRED_RE.test(msg)) {
        await markExpired(account);
        return { status: "failed", message: "Token 已过期，请在账号编辑中更新 JWT" };
      }
      if (res.code === 0) {
        // 站点协议要求提交后查 stats 确认；确认接口打不通时以提交结果为准
        const confirmed = await queryVoapiCheckedToday(account);
        if (confirmed === false) {
          return { status: "failed", message: "签到提交成功但站点未确认，请稍后重查" };
        }
        return { status: "success", message: msg };
      }
      return { status: "failed", message: msg || `签到失败（code ${res.code}）` };
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await markExpired(account);
        return { status: "failed", message: "Token 已过期，请在账号编辑中更新 JWT" };
      }
      return failedFromError(e);
    }
  },

  queryCheckedToday: queryVoapiCheckedToday,
};
