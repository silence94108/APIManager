import { patchAccount } from "@/storage/accounts";
import { accountsItem } from "@/storage/items";
import type { Account, SiteType } from "@/types";
import { quotaToUsd } from "@/utils/quota";
import { ApiError, siteFetch } from "./transport";

interface NewApiSelfResponse {
  success?: boolean;
  message?: string;
  data?: { quota?: number; used_quota?: number };
}

interface VoApiInfoResponse {
  code?: number;
  msg?: string;
  data?: { basicBalance?: number | string; bindBalance?: number | string };
}

interface Sub2ApiAuthMeResponse {
  code?: number;
  message?: string;
  data?: { balance?: number | string | null; quota_used?: number | string | null };
}

interface NewApiLogStatResponse {
  success?: boolean;
  message?: string;
  data?: { quota?: number };
}

export interface BalanceInfo {
  usd: number;
  /** 累计已用（USD）——站点响应不带该字段时为 undefined */
  totalUsedUsd?: number;
}

/** 今日消耗走 /api/log/self/stat，仅 new-api 系分叉支持 */
const TODAY_USAGE_SITE_TYPES: SiteType[] = ["new-api", "veloera", "anyrouter"];

/** 按站点类型拉当前余额与累计已用（USD） */
export async function fetchBalance(account: Account): Promise<BalanceInfo> {
  if (account.siteType === "sub2api") {
    // sub2api 信封响应 {code, message, data}；code 0 为成功，balance/quota_used 直接是美元额度
    const res = await siteFetch<Sub2ApiAuthMeResponse>(account, "/api/v1/auth/me");
    if (res.code !== 0) throw new ApiError(0, res.message || "获取账号信息失败");
    const usd = Number(res.data?.balance ?? 0);
    if (Number.isNaN(usd)) throw new ApiError(0, "余额字段解析失败");
    const used = Number(res.data?.quota_used ?? NaN);
    return { usd, totalUsedUsd: Number.isFinite(used) ? used : undefined };
  }

  if (account.siteType === "voapi-v2") {
    const res = await siteFetch<VoApiInfoResponse>(account, "/api/user/info", {
      rawToken: true,
    });
    const d = res.data ?? {};
    const usd = Number(d.basicBalance ?? 0) + Number(d.bindBalance ?? 0);
    if (Number.isNaN(usd)) throw new ApiError(0, "余额字段解析失败");
    return { usd };
  }

  const res = await siteFetch<NewApiSelfResponse>(account, "/api/user/self");
  if (res.success === false) throw new ApiError(0, res.message || "获取账号信息失败");
  const quota = res.data?.quota;
  if (typeof quota !== "number") throw new ApiError(0, "响应中缺少 quota 字段");
  const usedQuota = res.data?.used_quota;
  return {
    usd: quotaToUsd(quota),
    totalUsedUsd: typeof usedQuota === "number" ? quotaToUsd(usedQuota) : undefined,
  };
}

/** 拉今日消耗（USD）。站点不支持或接口失败返回 undefined——统计缺失不该阻塞余额刷新 */
export async function fetchTodayUsedUsd(account: Account): Promise<number | undefined> {
  if (!TODAY_USAGE_SITE_TYPES.includes(account.siteType)) return undefined;
  const day = new Date();
  const start = Math.floor(day.setHours(0, 0, 0, 0) / 1000);
  const end = Math.floor(day.setHours(23, 59, 59, 999) / 1000);
  const params = new URLSearchParams({
    p: "1",
    page_size: "10",
    token_name: "",
    model_name: "",
    start_timestamp: String(start),
    end_timestamp: String(end),
    type: "2",
  });
  try {
    const res = await siteFetch<NewApiLogStatResponse>(
      account,
      `/api/log/self/stat?${params.toString()}`,
    );
    if (res.success === false) return undefined;
    const q = res.data?.quota;
    return typeof q === "number" && Number.isFinite(q) ? quotaToUsd(q) : undefined;
  } catch {
    return undefined;
  }
}

/** 拉取并把余额 + 使用统计写回账号存储 */
export async function refreshAccountBalance(account: Account): Promise<number> {
  const [info, todayUsd] = await Promise.all([fetchBalance(account), fetchTodayUsedUsd(account)]);
  const now = Date.now();
  await patchAccount(account.id, {
    balance: { usd: info.usd, updatedAt: now },
    usage: { totalUsd: info.totalUsedUsd, todayUsd, updatedAt: now },
  });
  return info.usd;
}

/** 并行刷新一批账号余额，结果一次性批量写回（并发 patchAccount 会互相覆盖，必须批量） */
export async function refreshBalances(
  accounts: Account[],
): Promise<{ done: number; failed: { name: string; error: string }[] }> {
  const settled = await Promise.allSettled(
    accounts.map(async (a) => {
      const [info, todayUsd] = await Promise.all([fetchBalance(a), fetchTodayUsedUsd(a)]);
      return { info, todayUsd };
    }),
  );

  const byId = new Map<string, { info: BalanceInfo; todayUsd?: number }>();
  const failed: { name: string; error: string }[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      byId.set(accounts[i].id, r.value);
    } else {
      failed.push({
        name: accounts[i].name,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  if (byId.size > 0) {
    const now = Date.now();
    const all = await accountsItem.getValue();
    await accountsItem.setValue(
      all.map((a) => {
        const hit = byId.get(a.id);
        if (!hit) return a;
        return {
          ...a,
          balance: { usd: hit.info.usd, updatedAt: now },
          usage: { totalUsd: hit.info.totalUsedUsd, todayUsd: hit.todayUsd, updatedAt: now },
          updatedAt: now,
        };
      }),
    );
  }

  return { done: byId.size, failed };
}
