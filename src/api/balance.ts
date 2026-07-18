import { patchAccount } from "@/storage/accounts";
import { accountsItem } from "@/storage/items";
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

interface Sub2ApiAuthMeResponse {
  code?: number;
  message?: string;
  data?: { balance?: number | string | null };
}

/** 按站点类型拉当前余额（USD） */
export async function fetchBalance(account: Account): Promise<number> {
  if (account.siteType === "sub2api") {
    // sub2api 信封响应 {code, message, data}；code 0 为成功，balance 直接是美元额度
    const res = await siteFetch<Sub2ApiAuthMeResponse>(account, "/api/v1/auth/me");
    if (res.code !== 0) throw new ApiError(0, res.message || "获取账号信息失败");
    const usd = Number(res.data?.balance ?? 0);
    if (Number.isNaN(usd)) throw new ApiError(0, "余额字段解析失败");
    return usd;
  }

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

/** 并行刷新一批账号余额，结果一次性批量写回（并发 patchAccount 会互相覆盖，必须批量） */
export async function refreshBalances(
  accounts: Account[],
): Promise<{ done: number; failed: { name: string; error: string }[] }> {
  const settled = await Promise.allSettled(accounts.map((a) => fetchBalance(a)));

  const usdById = new Map<string, number>();
  const failed: { name: string; error: string }[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      usdById.set(accounts[i].id, r.value);
    } else {
      failed.push({
        name: accounts[i].name,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  if (usdById.size > 0) {
    const now = Date.now();
    const all = await accountsItem.getValue();
    await accountsItem.setValue(
      all.map((a) =>
        usdById.has(a.id)
          ? { ...a, balance: { usd: usdById.get(a.id)!, updatedAt: now }, updatedAt: now }
          : a,
      ),
    );
  }

  return { done: usdById.size, failed };
}
