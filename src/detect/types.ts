import type { SiteType } from "@/types";

/** 识别当前站点后，用于预填「添加账号」表单的草稿。 */
export interface DetectedAccount {
  /** 规范化 origin，如 https://api.example.com */
  url: string;
  /** 当前标签页标题——预填站点名称用，读不到则空 */
  title?: string;
  /** 页面 favicon 绝对 URL，读不到则空 */
  faviconUrl?: string;
  siteType: SiteType;
  /** 站点内用户 id，读不到则空串 */
  userId: string;
  /** Bearer token / voapi raw JWT；读不到则 undefined */
  accessToken?: string;
  username?: string;
}

/** detectCurrentSite 的结果：成功带草稿，失败带原因（供 toast） */
export type DetectResult =
  | { ok: true; account: DetectedAccount }
  | { ok: false; reason: string };
