import type { SiteType } from "@/types";

/**
 * 综合页面信号判定站点类型（精简版：不做端点探测，判不准兜底 new-api，由用户在预填表单里改）。
 *
 * @param hasVoapiStore extractSession 读到了 localStorage.userStore → 基本可确定 voapi-v2
 * @param title 页面 <title>，用于正则匹配 veloera / anyrouter
 * @param hostname 当前 tab 的 hostname，anyrouter 官方域名兜底
 */
export function detectSiteType(
  hasVoapiStore: boolean,
  title: string,
  hostname: string,
): SiteType {
  if (hasVoapiStore) return "voapi-v2";

  const t = title.toLowerCase();
  const h = hostname.toLowerCase();

  if (/veloera/i.test(t)) return "veloera";
  if (/any\s*router/i.test(t) || h.endsWith("anyrouter.top")) return "anyrouter";
  if (/voapi/i.test(t)) return "voapi-v2";

  // new-api 系（含 one-api / done-hub 等分叉）统一按 new-api 处理；判不准也兜底到此
  return "new-api";
}
