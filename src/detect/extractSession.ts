import type { NewApiSessionAuth } from "@/types";

/** extractSessionFromPage 的返回结构（页面注入读到的原始会话信息） */
export interface PageSession {
  userId: string;
  accessToken?: string;
  sessionAuth?: NewApiSessionAuth;
  username?: string;
  hasVoapiStore: boolean;
  /** 页面 favicon 绝对 URL，读不到则 undefined */
  faviconUrl?: string;
}

/**
 * 注入到中转站页面执行的函数，读取 localStorage / sessionStorage 里的账号会话信息，
 * 并在 new-api 系站点用**同源登录态**补全 access_token。
 *
 * ⚠️ 这段代码经 chrome.scripting.executeScript 序列化后在**页面上下文**运行，
 * 必须完全自包含：不能引用任何外部 import、模块级变量或闭包。所有逻辑内联。
 *
 * 为什么补账号和 token 放这里：页面缓存可能缺失，access_token 也不一定在缓存中，
 * 需调 /api/user/self 和 /api/user/token；页面上下文的 fetch 是同源请求，带 cookie，
 * 比在 popup/background 跨域请求更可靠。
 */
export async function extractSessionFromPage(): Promise<PageSession | null> {
  const readJson = (
    storageName: "localStorage" | "sessionStorage",
    key: string,
  ): Record<string, unknown> | null => {
    try {
      // 访问 Storage 本身也可能抛错，放在 try 内才能继续使用另一种存储或登录接口。
      const storage = storageName === "localStorage" ? localStorage : sessionStorage;
      const raw = storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const asId = (value: unknown): string => {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
    return "";
  };

  const asStr = (value: unknown): string | undefined => {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };

  // favicon：优先取页面声明的 <link rel="icon">（末个通常分辨率最高），末尾兜底 /favicon.ico
  const readFavicon = (): string | undefined => {
    try {
      const links = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
      );
      const href = links.map((l) => l.getAttribute("href")).filter(Boolean).pop();
      // href 可能是相对路径 / 协议相对，用页面 URL 绝对化
      if (href) return new URL(href, location.href).href;
      return new URL("/favicon.ico", location.origin).href;
    } catch {
      return undefined;
    }
  };
  const faviconUrl = readFavicon();

  // voapi-v2：token 在 userStore.auth.token（raw JWT），userId 在 user.id
  const userStore = readJson("localStorage", "userStore") ?? readJson("sessionStorage", "userStore");
  const auth =
    userStore && typeof userStore.auth === "object" && userStore.auth
      ? (userStore.auth as Record<string, unknown>)
      : null;
  const voapiToken = asStr(auth?.token);
  // 仅当真的从 userStore 读到 raw JWT 才认定 voapi-v2，避免同名键误判
  const hasVoapiStore = voapiToken !== undefined;

  // 新版把用户与访问令牌放在内存，只留下可读的会话标记；真实刷新凭据在 HttpOnly Cookie 中。
  let hasNewApiSession = false;
  try {
    hasNewApiSession = (document.cookie ?? "").split(";").some(
      (part) => part.trim().startsWith("new_api_has_session="),
    );
  } catch {
    // 无法访问 cookie 时仍尝试旧版缓存与同源账号接口。
  }
  if (hasNewApiSession && !hasVoapiStore) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const refresh = async (): Promise<PageSession | null> => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch("/api/user/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" },
          credentials: "include",
          signal: controller.signal,
        });
        if (!(res.headers.get("content-type") ?? "").includes("json")) return null;
        const body = await res.json();
        // 页面自身也可能正在刷新，短暂竞争可以重试；失效或账号变更不能继续尝试。
        if (res.status === 409 && body?.code === "AUTH_REFRESH_RACE" && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, [100, 250, 500][attempt]));
          continue;
        }
        const data = body?.data;
        const token = asStr(data?.access_token);
        const sessionId = asStr(data?.session?.sid);
        if (
          !res.ok || body?.success !== true || !token || !sessionId ||
          data.token_type !== "Bearer" || data.session.current !== true ||
          !Number.isSafeInteger(data.user?.id) || data.user.id <= 0 ||
          typeof data.access_expires_at !== "number" || !Number.isFinite(data.access_expires_at) ||
          data.access_expires_at <= Date.now() / 1000
        ) return null;
        return {
          userId: String(data.user.id),
          username: asStr(data.user.username),
          accessToken: token,
          sessionAuth: { sessionId, accessExpiresAt: data.access_expires_at },
          hasVoapiStore: false,
          faviconUrl,
        };
      }
      return null;
    };
    try {
      // 与站点自身使用同一个 Web Lock，避免在当前页面刷新 Cookie 时产生竞争。
      if (typeof navigator !== "undefined" && navigator.locks) {
        return await navigator.locks.request(
          "new-api:auth-refresh", { mode: "exclusive", signal: controller.signal }, refresh,
        );
      }
      return await refresh();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // 当前标签页的 sessionStorage 优先，回退旧版 localStorage；不拼接不同账号的字段。
  const user = [readJson("sessionStorage", "user"), readJson("localStorage", "user")].find(
    (candidate) => asId(candidate?.id) || asStr(candidate?.access_token),
  );

  let userId = asId(user?.id);
  // token 优先取 voapi 的 raw JWT，否则取 user.access_token
  let accessToken = voapiToken ?? asStr(user?.access_token);
  let username = asStr(user?.username);

  // 缓存缺失时也查询当前登录账号，不能因为缺少 userId 而直接判为未登录。
  if (!hasVoapiStore && (!userId || !accessToken)) {
    const getData = async (path: string): Promise<unknown> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        // 缺少 ID 时先由 cookie 获取账号，拿到 ID 后后续请求再带兼容头。
        if (userId) {
          for (const name of ["New-API-User", "Veloera-User", "voapi-user", "User-id"]) {
            headers[name] = userId;
          }
        }
        const res = await fetch(path, {
          method: "GET",
          headers,
          credentials: "include",
          signal: controller.signal,
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok || !contentType.includes("json")) return undefined;
        const body = (await res.json()) as { success?: boolean; data?: unknown } | null;
        if (body?.success === false) return undefined;
        return body?.data;
      } catch {
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    };

    // 1) /api/user/self → 当前账号；旧版可能顺带返回已生成的 access_token。
    const selfData = await getData("/api/user/self");
    if (selfData && typeof selfData === "object" && !Array.isArray(selfData)) {
      const self = selfData as Record<string, unknown>;
      const selfId = asId(self.id);
      // 接口确认的账号优先；若与缓存不同，不能沿用缓存里的用户名或 Token。
      if (selfId && selfId !== userId) {
        userId = selfId;
        username = asStr(self.username);
        accessToken = asStr(self.access_token);
      } else {
        username = asStr(self.username) ?? username;
        accessToken = asStr(self.access_token) ?? accessToken;
      }
    }
    // 2) 已识别到账号但仍无 Token → /api/user/token（data 直接是 token 字符串）。
    if (!accessToken && userId) {
      const tokenData = await getData("/api/user/token");
      accessToken = asStr(tokenData);
    }
  }

  // 什么都没读到 → 判定为未登录/无账号信息
  if (!userId && !accessToken) return null;

  return { userId, accessToken, username, hasVoapiStore, faviconUrl };
}
