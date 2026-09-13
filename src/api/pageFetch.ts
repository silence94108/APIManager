import { withRequestTimeout } from "./requestTimeout";

/** 在同源标签页发送请求，兼容仅接受页面 Cookie 的旧版站点。 */
export interface PageFetchRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  credentials: RequestCredentials;
  /** Cookie 认证必须先确认当前浏览器登录的仍是保存的账号。 */
  verifyUser?: { id: string; endpoint: string };
  /** 与新版 New API 前端共享刷新锁，X-Auth-Session 仍由请求头绑定。 */
  refreshSession?: boolean;
  /** 签到需加载具体页面时指定；只允许与请求地址同源。 */
  pageUrl?: string;
  /** 创建新页面触发站点的自动签到，不刷新用户正在使用的标签页。 */
  freshPage?: boolean;
  /** 包括打开页面与执行请求的总等待上限。 */
  timeoutMs?: number;
}

interface PageResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

type PageFetchResult =
  | { response: PageResponse }
  | { error: { status: number; message: string } };

export class PageFetchError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "PageFetchError";
  }
}

/**
 * 经 executeScript 序列化到页面，必须自包含。运行在隔离环境，使用浏览器原生 fetch；
 * 注入前后均检查来源，禁止请求重定向，避免标签页导航后把认证头发给其他站点。
 */
export async function fetchInPage(
  request: PageFetchRequest,
  deadline = Date.now() + (request.timeoutMs ?? (request.refreshSession ? 8000 : 15000)),
): Promise<PageFetchResult> {
  const url = new URL(request.url);
  if (!/^https?:$/.test(url.protocol) || location.origin !== url.origin) {
    return { error: { status: 0, message: "站点页面已跳转，请打开原站点后重试" } };
  }

  const controller = new AbortController();
  const remaining = Math.min(deadline - Date.now(), request.refreshSession ? 8000 : 15000);
  if (remaining <= 0) return { error: { status: 0, message: "站点页面请求已超时，请重试" } };
  const timer = setTimeout(() => controller.abort(), remaining);
  const serialize = async (response: Response): Promise<{ response: PageResponse }> => ({
    response: {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    },
  });
  const send = (target: string, method: "GET" | "POST", body?: string, headers = request.headers) => {
    // 后台标签页可能暂停计时器；恢复后也不能继续提交已经超时的请求。
    if (Date.now() >= deadline || controller.signal.aborted) {
      controller.abort();
      throw new Error("站点页面请求已超时");
    }
    if (location.origin !== url.origin || new URL(target).origin !== url.origin) {
      throw new Error("站点页面已跳转，请打开原站点后重试");
    }
    return fetch(target, {
      method,
      headers,
      body,
      credentials: request.credentials,
      mode: "same-origin",
      redirect: "error",
      signal: controller.signal,
    });
  };
  const run = async (): Promise<PageFetchResult> => {
    if (request.freshPage) {
      // 旧版 AnyRouter 在控制台加载后自动 sign_in，留出首屏初始化时间再复核结果。
      await new Promise((resolve) => setTimeout(resolve, Math.min(1500, remaining)));
    }
    if (request.verifyUser) {
      const identityUrl = new URL(request.verifyUser.endpoint, url.origin).href;
      // 只校验实际 Cookie 所属账号，不能让保存的 Bearer Token 掩盖浏览器已切换账号。
      const cookieHeaders = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => name.toLowerCase() !== "authorization"),
      );
      const identity = await send(identityUrl, "GET", undefined, cookieHeaders);
      const snapshot = await serialize(identity);
      // 登录页/验证页保留原 HTTP 信息，交给后台统一分类，不能当成签到成功。
      if (!identity.ok || !(identity.headers.get("content-type") ?? "").includes("json")) {
        return snapshot;
      }
      let data: { success?: boolean; data?: { id?: unknown } };
      try {
        data = JSON.parse(snapshot.response.body);
      } catch {
        return { error: { status: 401, message: "无法确认站点登录账号，请登录后重新识别" } };
      }
      const id = data?.data?.id;
      if (data?.success === false || (typeof id !== "string" && typeof id !== "number") || !request.verifyUser.id) {
        return { error: { status: 401, message: "站点登录已失效，请登录后重新识别账号" } };
      }
      if (String(id) !== request.verifyUser.id) {
        return { error: { status: 409, message: "浏览器当前登录账号与保存的账号不一致，请登录后重新识别" } };
      }
      if (request.method === "GET" && url.href === identityUrl) return snapshot;
    }
    return serialize(await send(url.href, request.method, request.body));
  };

  try {
    if (request.refreshSession && typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request(
        "new-api:auth-refresh", { mode: "exclusive", signal: controller.signal }, run,
      );
    }
    return await run();
  } catch {
    return {
      error: {
        status: 0,
        message: controller.signal.aborted || Date.now() >= deadline
          ? "站点页面请求超时，请稍后重试"
          : "站点页面请求失败，请确认已登录且页面验证已完成后重试",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

interface SitePage {
  tabId: number;
  owned: boolean;
}

// 余额和用量查询可能同时回退；共享临时页，最后一个请求结束后再关闭。
const pages = new Map<string, { ready: Promise<SitePage>; users: number }>();
const temporaryTabs = new Set<number>();

async function closeOwnedPage(page: SitePage): Promise<void> {
  if (!page.owned) return;
  try {
    await browser.tabs.remove(page.tabId);
  } catch {
    // 用户可能已手动关闭。
  } finally {
    temporaryTabs.delete(page.tabId);
  }
}

function sameOrigin(url: string | undefined, origin: string): boolean {
  try {
    return !!url && new URL(url).origin === origin;
  } catch {
    return false;
  }
}

async function waitForPage(tabId: number, origin: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error);
      else resolve();
    };
    const check = async () => {
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab.status === "complete") {
          finish(sameOrigin(tab.url, origin) ? undefined : new Error("站点页面已跳转"));
        }
      } catch {
        finish(new Error("站点页面已关闭"));
      }
    };
    const onUpdated = (id: number) => { if (id === tabId) void check(); };
    const onRemoved = (id: number) => { if (id === tabId) finish(new Error("站点页面已关闭")); };
    const timer = setTimeout(() => finish(new Error("站点页面加载超时")), 20_000);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    void check();
  });
}

async function openSitePage(origin: string, pageUrl: string, freshPage: boolean): Promise<SitePage> {
  const tabs = freshPage ? [] : await browser.tabs.query({});
  const existing = tabs.find((tab) => tab.id !== undefined && !temporaryTabs.has(tab.id) && !tab.discarded && sameOrigin(tab.url, origin));
  const page = existing
    ? { tabId: existing.id!, owned: false }
    : { tabId: (await browser.tabs.create({ url: pageUrl, active: false })).id!, owned: true };
  try {
    if (page.tabId === undefined) throw new Error("无法打开站点页面");
    if (page.owned) temporaryTabs.add(page.tabId);
    await waitForPage(page.tabId, origin);
    return page;
  } catch (error) {
    if (page.owned && page.tabId !== undefined) void closeOwnedPage(page);
    throw error;
  }
}

/** 仅操作本站标签页；优先复用，不关闭用户原有标签页。 */
export async function fetchFromSitePage(request: PageFetchRequest): Promise<Response> {
  const origin = new URL(request.url).origin;
  const pageUrl = new URL(request.pageUrl ?? "/", origin).href;
  if (!sameOrigin(pageUrl, origin)) throw new PageFetchError(0, "签到页面与账号站点不同源，请检查签到页地址");
  const key = JSON.stringify([origin, request.freshPage ? pageUrl : "reuse"]);
  const timeoutMs = request.timeoutMs ?? 30000;
  const deadline = Date.now() + timeoutMs;
  const timeoutError = () => new PageFetchError(0, "站点页面响应超时，已停止本次请求，请稍后重试");
  const checkDeadline = () => { if (Date.now() >= deadline) throw timeoutError(); };
  let page = pages.get(key);
  if (!page) {
    page = { ready: openSitePage(origin, pageUrl, request.freshPage === true), users: 0 };
    pages.set(key, page);
  }
  page.users++;
  try {
    return await withRequestTimeout((async () => {
      const { tabId } = await page.ready;
      checkDeadline();
      const tab = await browser.tabs.get(tabId);
      checkDeadline();
      if (!sameOrigin(tab.url, origin)) throw new PageFetchError(0, "站点页面已跳转，请打开原站点后重试");
      const [result] = await browser.scripting.executeScript({
        target: { tabId },
        func: fetchInPage,
        args: [request, deadline],
      });
      checkDeadline();
      const value = result?.result;
      if (!value) throw new Error("页面未返回请求结果");
      if ("error" in value) throw new PageFetchError(value.error.status, value.error.message);
      const { status, headers, body } = value.response;
      return new Response([204, 205, 304].includes(status) ? null : body, { status, headers });
    })(), timeoutMs, timeoutError);
  } catch (error) {
    if (error instanceof PageFetchError) throw error;
    throw new PageFetchError(0, "无法在站点页面重试，请打开该站并登录后重试");
  } finally {
    page.users--;
    if (page.users === 0) {
      pages.delete(key);
      // 清理不能反过来阻塞超时返回；页面稍后才创建完成时也会关闭，且不会再发送请求。
      void page.ready.then(closeOwnedPage).catch(() => {});
    }
  }
}
