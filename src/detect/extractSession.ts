import type { NewApiSessionAuth } from "@/types";

/** 只有服务端已确认身份的会话才可用于预填或匹配已保存账号。 */
export interface PageSession {
  userId: string;
  accessToken?: string;
  sessionAuth?: NewApiSessionAuth;
  username?: string;
  hasVoapiStore: boolean;
  faviconUrl?: string;
}

/**
 * 经 executeScript 序列化到页面，必须自包含，不能引用模块级函数或变量。
 * 缓存只提供候选信息；Cookie / 当前页面 JWT 经服务端确认后才返回身份。
 */
export async function extractSessionFromPage(
  expectedOrigin?: string,
  deadline = Date.now() + 8000,
): Promise<PageSession | null> {
  const sourceUrl = location.href;
  const origin = location.origin;
  if ((expectedOrigin && expectedOrigin !== origin) || Date.now() >= deadline) return null;

  const readRaw = (storageName: "localStorage" | "sessionStorage", key: string): string | null => {
    try {
      return (storageName === "localStorage" ? localStorage : sessionStorage).getItem(key);
    } catch {
      return null;
    }
  };
  const readJson = (storageName: "localStorage" | "sessionStorage", key: string): Record<string, unknown> | null => {
    try {
      const value = JSON.parse(readRaw(storageName, key) ?? "null");
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  };
  const asStr = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  const asId = (value: unknown): string => {
    const id = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
    return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? String(id) : "";
  };
  const cookies = (): string => {
    try { return document.cookie ?? ""; } catch { return ""; }
  };
  const evidence = () => JSON.stringify([
    readRaw("localStorage", "user"), readRaw("sessionStorage", "user"),
    readRaw("localStorage", "userStore"), readRaw("sessionStorage", "userStore"), cookies(),
  ]);
  const initialEvidence = evidence();
  const controller = new AbortController();
  const isCurrent = () => !controller.signal.aborted && Date.now() < deadline &&
    location.href === sourceUrl && evidence() === initialEvidence;

  let faviconUrl: string | undefined;
  try {
    const href = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))
      .map((link) => link.getAttribute("href")).filter(Boolean).pop();
    faviconUrl = new URL(href || "/favicon.ico", sourceUrl).href;
  } catch { /* favicon 不影响身份核验。 */ }

  const headersFor = (id: string): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (id) for (const name of ["New-API-User", "Veloera-User", "voapi-user", "User-id"]) headers[name] = id;
    return headers;
  };
  const send = async (path: string, options: RequestInit) => {
    if (!isCurrent()) throw new Error("当前页面登录态已变化");
    const response = await fetch(path, {
      ...options, mode: "same-origin", redirect: "error", signal: controller.signal,
    });
    if (!isCurrent() || !(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) return null;
    const body = await response.json();
    return isCurrent() ? { response, body } : null;
  };

  const run = async (): Promise<PageSession | null> => {
    // VoAPI 的浏览器身份来自页面 JWT，不能只相信另一个 user 缓存里的 ID。
    const userStore = readJson("sessionStorage", "userStore") ?? readJson("localStorage", "userStore");
    const auth = userStore?.auth;
    const voapiToken = auth && typeof auth === "object" ? asStr((auth as Record<string, unknown>).token) : undefined;
    if (voapiToken) {
      const result = await send("/api/user/info", {
        method: "GET", credentials: "omit", headers: { ...headersFor(""), Authorization: voapiToken },
      });
      const data = result?.body?.data;
      const userId = asId(data?.id);
      if (!result?.response.ok || result.body?.code !== 0 || !userId) return null;
      return { userId, username: asStr(data.username), accessToken: voapiToken, hasVoapiStore: true, faviconUrl };
    }

    // 新版 New API 将用户与令牌保存在页面内存；续期响应提供已确认的当前身份。
    if (cookies().split(";").some((part) => part.trim().startsWith("new_api_has_session="))) {
      const refresh = async (): Promise<PageSession | null> => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const result = await send("/api/user/auth/refresh", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" },
          });
          if (!result) return null;
          const { response, body } = result;
          if (response.status === 409 && body?.code === "AUTH_REFRESH_RACE" && attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, [100, 250, 500][attempt]));
            continue;
          }
          const data = body?.data;
          const accessToken = asStr(data?.access_token);
          const sessionId = asStr(data?.session?.sid);
          const userId = asId(data?.user?.id);
          if (!response.ok || body?.success !== true || !accessToken || !sessionId || !userId ||
            data.token_type !== "Bearer" || data.session.current !== true ||
            typeof data.access_expires_at !== "number" || !Number.isFinite(data.access_expires_at) ||
            data.access_expires_at <= Date.now() / 1000) return null;
          return {
            userId, username: asStr(data.user.username), accessToken,
            sessionAuth: { sessionId, accessExpiresAt: data.access_expires_at },
            hasVoapiStore: false, faviconUrl,
          };
        }
        return null;
      };
      if (typeof navigator !== "undefined" && navigator.locks) {
        return navigator.locks.request("new-api:auth-refresh", { mode: "exclusive", signal: controller.signal }, refresh);
      }
      return refresh();
    }

    const cached = [readJson("sessionStorage", "user"), readJson("localStorage", "user")]
      .find((candidate) => asId(candidate?.id) || asStr(candidate?.access_token));
    const cachedId = asId(cached?.id);
    // 身份查询不带 Bearer，避免旧 Token 掩盖 Cookie 已切换到另一个账号。
    const identity = await send("/api/user/self", {
      method: "GET", credentials: "include", headers: headersFor(cachedId),
    });
    const self = identity?.body?.data;
    const userId = asId(self?.id);
    if (!identity?.response.ok || identity.body?.success === false || !userId) return null;

    const sameAccount = userId === cachedId;
    const username = asStr(self.username) ?? (sameAccount ? asStr(cached?.username) : undefined);
    let accessToken = asStr(self.access_token);
    // 服务端未返回 Token 时，缓存 Token 也必须独立验证后才用于更新已有账号。
    if (!accessToken) {
      let candidate = sameAccount ? asStr(cached?.access_token) : undefined;
      if (!candidate) {
        const tokenResult = await send("/api/user/token", {
          method: "GET", credentials: "include", headers: headersFor(userId),
        });
        if (tokenResult?.response.ok && tokenResult.body?.success !== false) candidate = asStr(tokenResult.body?.data);
      }
      if (candidate) {
        try {
          const checked = await send("/api/user/self", {
            method: "GET", credentials: "omit", headers: { ...headersFor(userId), Authorization: "Bearer " + candidate },
          });
          if (checked?.response.ok && checked.body?.success !== false && asId(checked.body?.data?.id) === userId) accessToken = candidate;
        } catch { /* Token 核验失败时仅返回已确认身份，已有有效凭据由表单保留。 */ }
      }
    }
    return { userId, username, accessToken, hasVoapiStore: false, faviconUrl };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      run(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(null); }, Math.max(0, deadline - Date.now()));
      }),
    ]);
    return isCurrent() ? result : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
