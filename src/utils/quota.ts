/** new-api 系 quota → USD 换算因子 */
export const QUOTA_PER_USD = 500000;

export function quotaToUsd(quota: number): number {
  return quota / QUOTA_PER_USD;
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
