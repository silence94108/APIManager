import type { Account, ProviderResult } from "@/types";
import { withRequestTimeout } from "@/api/requestTimeout";
import { extractSessionFromPage } from "@/detect/extractSession";
import { resolveCheckinPageUrls } from "./helpers";
import { getProvider } from "./providers";
import { prepareCheckinSubmission } from "./execution";
import { uncertainCheckin } from "./providers/shared";
import type { CheckinExecutionOptions } from "./types";

/**
 * 简化版 Turnstile 辅助签到：开临时小窗口加载站点签到页，注入脚本点击站点
 * 自己的签到按钮——让站点前端自己的流程（含 Turnstile 组件出 token）完成签到，
 * 点击前记录待确认状态，之后仅查询今日状态，不能再提交签到请求。
 *
 * 隐形/托管模式的 Turnstile 无需用户交互即可全自动；交互式验证窗口会留给用户点。
 * 尚未点击时可尝试下一候选；点击后未确认则保留不确定结果并停止。
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
function checkinTrigger(click: boolean, expectedUrl: string, deadline: number): "clicked" | "found" | "not_found" {
  if (location.href !== expectedUrl || Date.now() >= deadline) return "not_found";
  const positive = /(签到|check\s*in|checkin)/i;
  const negative = /(已签到|already)/i;
  const nodes = document.querySelectorAll<HTMLElement>('button, a, [role="button"]');
  for (const el of nodes) {
    const text = (el.textContent || "").trim();
    if (!text || text.length > 24) continue;
    if (negative.test(text) || !positive.test(text)) continue;
    if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;
    if (!click) return "found";
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
    }).catch(done);
  });
}

/** 尝试辅助签到。成功返回 success 结果；失败/不支持返回 null（调用方保留原结果） */
export async function assistTurnstileCheckin(account: Account, options: CheckinExecutionOptions = {}): Promise<ProviderResult | null> {
  if (options.reconcileOnly) return uncertainCheckin();
  // AnyRouter 已由 provider 加载页面触发自动签到，不存在需要点击的签到按钮。
  if (account.siteType === "anyrouter") return null;
  // 无默认签到页且未自定义链接的类型不知道该开哪个页面
  const urls = resolveCheckinPageUrls(account).filter((url) => new URL(url).origin === new URL(account.url).origin);
  if (urls.length === 0) return null;

  // 新老主题路由不同；没有按钮才继续候选，点击后的不确定结果也必须立即返回。
  for (const url of urls) {
    const result = await tryCheckinViaPage(account, url, options);
    if (result) return result;
  }
  return null;
}

/** 在单个签到页上开窗口、核验身份、记录并点击，再只读复核；已点击的失败不能返回 null。 */
async function tryCheckinViaPage(account: Account, url: string, options: CheckinExecutionOptions): Promise<ProviderResult | null> {
  let winId: number | undefined;
  let attemptedClick = false;
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

    const tab = await browser.tabs.get(tabId);
    if (!tab.url || new URL(tab.url).origin !== new URL(account.url).origin) return null;
    const [found] = await withRequestTimeout(browser.scripting.executeScript({
      target: { tabId },
      func: checkinTrigger,
      args: [false, tab.url, Date.now() + 5000],
    }), 5000, () => new Error("签到按钮查询超时"));
    if (found?.result !== "found") return null;

    // 真实页面可能登录了另一账号，点击前复用经过服务端核验的身份提取。
    const [identity] = await withRequestTimeout(browser.scripting.executeScript({
      target: { tabId }, func: extractSessionFromPage,
      args: [new URL(account.url).origin, Date.now() + 8000],
    }), 9000, () => new Error("页面身份核验超时"));
    if (identity?.result?.userId !== account.userId) return null;
    const blocked = await prepareCheckinSubmission(options);
    if (blocked) return blocked;
    attemptedClick = true;
    const [injection] = await withRequestTimeout(browser.scripting.executeScript({
      target: { tabId }, func: checkinTrigger,
      args: [true, tab.url, Date.now() + 5000],
    }), 5000, () => new Error("页面点击结果未确认"));
    if (injection?.result === "not_found") {
      attemptedClick = false;
      return null;
    }
    if (injection?.result !== "clicked") return uncertainCheckin();

    await sleep(SOLVE_WAIT_MS);

    const verify = await getProvider(account.siteType).checkIn(account, { reconcileOnly: true });
    if (verify.status === "success" || verify.status === "already_checked") {
      return { status: "success", message: "已通过临时窗口签到并由站点确认", capability: "supported" };
    }
    return { ...uncertainCheckin(), retryAt: verify.retryAt, capability: verify.capability };
  } catch {
    return attemptedClick ? uncertainCheckin() : null;
  } finally {
    if (winId !== undefined) await browser.windows.remove(winId).catch(() => {});
  }
}
