import { normalizeOrigin } from "@/utils/url";
import { detectSiteType } from "./detectSiteType";
import { extractSessionFromPage, type PageSession } from "./extractSession";
import type { DetectResult } from "./types";

/**
 * 识别当前活动标签页的中转站账号。
 *
 * 流程：取当前 tab → 注入 extractSessionFromPage 读 localStorage → 判站点类型 → 组装草稿。
 * 全程只读当前 tab，读不到就返回失败原因（不做后台临时窗口/API 三级降级——精简版转手动录入）。
 */
export async function detectCurrentSite(): Promise<DetectResult> {
  let tab: { id?: number; url?: string; title?: string } | undefined;
  try {
    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    tab = active;
  } catch {
    return { ok: false, reason: "无法读取当前标签页" };
  }

  if (!tab?.id || !tab.url) {
    return { ok: false, reason: "当前标签页不可用" };
  }

  let origin: string;
  let hostname: string;
  try {
    const parsed = new URL(tab.url);
    if (!/^https?:$/.test(parsed.protocol)) {
      return { ok: false, reason: "请在中转站页面（http/https）打开后再识别" };
    }
    origin = normalizeOrigin(tab.url);
    hostname = parsed.hostname;
  } catch {
    return { ok: false, reason: "当前页面不是有效的站点地址" };
  }

  let session: PageSession | null = null;
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSessionFromPage,
    });
    session = result?.result ?? null;
  } catch {
    // 常见于 chrome:// 等受限页面、或页面禁止注入
    return { ok: false, reason: "无法读取此页面（可能是浏览器内置页或受保护站点）" };
  }

  if (!session) {
    return { ok: false, reason: "未在当前页面识别到账号——请确认已登录该中转站" };
  }

  const siteType = detectSiteType(session.hasVoapiStore, tab.title ?? "", hostname);

  return {
    ok: true,
    account: {
      url: origin,
      title: tab.title?.trim() || undefined,
      faviconUrl: session.faviconUrl,
      siteType,
      userId: session.userId,
      accessToken: session.accessToken,
      username: session.username,
    },
  };
}
