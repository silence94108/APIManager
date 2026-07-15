import { patchAccount } from "@/storage/accounts";
import type { Account } from "@/types";
import { quotaToUsd } from "@/utils/quota";
import { ApiError, siteFetch } from "./transport";

interface NewApiSelfResponse {
  success?: boolean;
  message?: string;
  data?: { quota?: number };
}

interface VoApiInfoResponse {
  code?: number;
  msg?: string;
  data?: { basicBalance?: number | string; bindBalance?: number | string };
}

/** 按站点类型拉当前余额（USD） */
export async function fetchBalance(account: Account): Promise<number> {
  if (account.siteType === "voapi-v2") {
    const res = await siteFetch<VoApiInfoResponse>(account, "/api/user/info", {
      rawToken: true,
    });
    const d = res.data ?? {};
    const usd = Number(d.basicBalance ?? 0) + Number(d.bindBalance ?? 0);
    if (Number.isNaN(usd)) throw new ApiError(0, "余额字段解析失败");
    return usd;
  }

  const res = await siteFetch<NewApiSelfResponse>(account, "/api/user/self");
  if (res.success === false) throw new ApiError(0, res.message || "获取账号信息失败");
  const quota = res.data?.quota;
  if (typeof quota !== "number") throw new ApiError(0, "响应中缺少 quota 字段");
  return quotaToUsd(quota);
}

/** 拉取并把余额写回账号存储 */
export async function refreshAccountBalance(account: Account): Promise<number> {
  const usd = await fetchBalance(account);
  await patchAccount(account.id, { balance: { usd, updatedAt: Date.now() } });
  return usd;
}
