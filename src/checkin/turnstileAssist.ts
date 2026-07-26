import type { Account, ProviderResult } from "@/types";
import { resolveCheckinPageUrls } from "./helpers";
import { getProvider } from "./providers";

/**
 * 简化版 Turnstile 辅助签到：开临时小窗口加载站点签到页，注入脚本点击站点
 * 自己的签到按钮——让站点前端自己的流程（含 Turnstile 组件出 token）完成签到，
 * 然后从后台重发一次签到 API 复核结果（页面已签成功时服务端会答"已签到"）。
 *
 * 隐形/托管模式的 Turnstile 无需用户交互即可全自动；交互式验证窗口会留给用户点。
 * 任何一步失败都返回 null，调用方保持原 needs_verification 结果不变。
 */

const PAGE_LOAD_TIMEOUT_MS = 20_000;
/** SPA 首屏渲染等待 */
const RENDER_WAIT_MS = 2500;
/** 点击后等待 Turnstile 出 token + 站点前端完成请求 */
const SOLVE_WAIT_MS = 9000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 注入页面的按钮点击（必须自包含，不能引用外部标识符）——文案匹配签到、排除已签 */
function clickCheckinTrigger(): "clicked" | "not_found" {
  const positive = /(签到|check\s*in|checkin)/i;
  const negative = /(已签到|already)/i;
  const nodes = document.querySelectorAll<HTMLElement>('button, a, [role="button"]');
  for (const el of nodes) {
    const text = (el.textContent || "").trim();
    if (!text || text.length > 24) continue;
    if (negative.test(text) || !positive.test(text)) continue;
    el.click();
    return "clicked";
  }
  return "not_found";
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, PAGE_LOAD_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id: number, changeInfo: { status?: string }) {
      if (id === tabId && changeInfo.status === "complete") done();
    }
    browser.tabs.onUpdated.addListener(listener);
    // 监听注册前可能已加载完，补查一次
    void browser.tabs.get(tabId).then((t) => {
      if (t.status === "complete") done();
    });
  });
}

/** 尝试辅助签到。成功返回 success 结果；失败/不支持返回 null（调用方保留原结果） */
export async function assistTurnstileCheckin(account: Account): Promise<ProviderResult | null> {
  // 无默认签到页且未自定义链接的类型不知道该开哪个页面
  const urls = resolveCheckinPageUrls(account);
  if (urls.length === 0) return null;

  // 新老主题签到页路由不同，逐个候选串行尝试，任一命中签到按钮且复核通过即成功、短路返回
  for (const url of urls) {
    const result = await tryCheckinViaPage(account, url);
    if (result) return result;
  }
  return null;
}

/** 在单个签到页 URL 上尝试一轮：开临时窗口→等渲染→注入点击→服务端复核。任一步不成返回 null */
async function tryCheckinViaPage(account: Account, url: string): Promise<ProviderResult | null> {
  let winId: number | undefined;
  try {
    const win = await browser.windows.create({
      url,
      type: "popup",
      width: 460,
      height: 680,
    });
    if (!win) return null;
    winId = win.id;
    const tabId = win.tabs?.[0]?.id;
    if (tabId === undefined) return null;

    await waitForTabComplete(tabId);
    await sleep(RENDER_WAIT_MS);

    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: clickCheckinTrigger,
    });
    if (injection?.result !== "clicked") return null;

    await sleep(SOLVE_WAIT_MS);

    // 服务端复核：页面流程若已完成，这次 API 重发会返回"已签到"
    const verify = await getProvider(account.siteType).checkIn(account);
    if (verify.status === "success" || verify.status === "already_checked") {
      return { status: "success", message: "已通过临时窗口自动完成人机验证" };
    }
    return null;
  } catch {
    return null;
  } finally {
    if (winId !== undefined) await browser.windows.remove(winId).catch(() => {});
  }
}
