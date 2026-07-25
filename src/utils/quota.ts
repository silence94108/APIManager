/** new-api 系 quota → USD 换算因子 */
import { BALANCE_SITE_TYPES, type Account } from "@/types";

export const QUOTA_PER_USD = 500000;

export function quotaToUsd(quota: number): number {
  return quota / QUOTA_PER_USD;
}

/** 业务规则"哪些账号计入总额"的唯一出处：disabled 不计，无余额按 0 */
export function sumBalanceUsd(
  accounts: Array<{ disabled: boolean; balance?: { usd: number } }>,
): number {
  return accounts.reduce((sum, a) => sum + (a.disabled ? 0 : (a.balance?.usd ?? 0)), 0);
}

/** $1,234.56；小数固定两位，负数照常 */
export function formatUsd(usd: number): string {
  return usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * 用量行文案（popup 与设置页共用，保证两处口径一致）：
 * 会拉余额的站点显「今日 X · 累计 Y」，某口径拉不到补占位「—」（区分"支持但暂无"与"真的 0 消耗"）；
 * other 纯记录型不拉余额、无用量概念，返回 null 不显示该行。
 */
export function formatUsageLine(account: Account): string | null {
  if (!BALANCE_SITE_TYPES.includes(account.siteType)) return null;
  const fmt = (v?: number) => (v !== undefined ? formatUsd(v) : "—");
  return `今日 ${fmt(account.usage?.todayUsd)} · 累计 ${fmt(account.usage?.totalUsd)}`;
}
