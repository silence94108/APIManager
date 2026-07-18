/** extractSessionFromPage 的返回结构（页面注入读到的原始会话信息） */
export interface PageSession {
  userId: string;
  accessToken?: string;
  username?: string;
  hasVoapiStore: boolean;
  /** 页面 favicon 绝对 URL，读不到则 undefined */
  faviconUrl?: string;
}

/**
 * 注入到中转站页面执行的函数，读取 localStorage 里的账号会话信息，
 * 并在 new-api 系站点用**同源登录态**补全 access_token。
 *
 * ⚠️ 这段代码经 chrome.scripting.executeScript 序列化后在**页面上下文**运行，
 * 必须完全自包含：不能引用任何外部 import、模块级变量或闭包。所有逻辑内联。
 *
 * 为什么补 token 放这里：new-api 系的 access_token 不在 localStorage，需调
 * /api/user/self 取；页面上下文的 fetch 是同源请求，天然带 cookie、无 CORS 问题，
 * 比在 popup/background 跨域请求更可靠。
 */
export async function extractSessionFromPage(): Promise<PageSession | null> {
  const readJson = (key: string): Record<string, unknown> | null => {
    try {
      const raw = localStorage.getItem(key);
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
  const userStore = readJson("userStore");
  const auth =
    userStore && typeof userStore.auth === "object" && userStore.auth
      ? (userStore.auth as Record<string, unknown>)
      : null;
  const voapiToken = asStr(auth?.token);
  // 仅当真的从 userStore 读到 raw JWT 才认定 voapi-v2，避免同名键误判
  const hasVoapiStore = voapiToken !== undefined;

  // 通用（new-api 系 / veloera / anyrouter）：都在 localStorage.user
  const user = readJson("user");

  const userId = asId(user?.id);
  // token 优先取 voapi 的 raw JWT，否则取 user.access_token
  let accessToken = voapiToken ?? asStr(user?.access_token);
  const username = asStr(user?.username);

  // new-api 系：localStorage 通常没有 access_token，用同源登录态调 API 补全
  if (!accessToken && !hasVoapiStore && userId) {
    const getData = async (path: string): Promise<unknown> => {
      try {
        const res = await fetch(path, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            // 各分叉后端认不同的用户 id 头，全部带上（与项目 buildCompatUserHeaders 一致）
            "New-API-User": userId,
            "Veloera-User": userId,
            "voapi-user": userId,
            "User-id": userId,
          },
          credentials: "include",
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok || !contentType.includes("json")) return undefined;
        const body = (await res.json()) as { data?: unknown };
        return body?.data;
      } catch {
        return undefined;
      }
    };

    // 1) /api/user/self → data.access_token（站上已生成过 token 时有值）
    const selfData = await getData("/api/user/self");
    if (selfData && typeof selfData === "object") {
      accessToken = asStr((selfData as Record<string, unknown>).access_token);
    }
    // 2) 仍为空 → /api/user/token 让站点新建一个（data 直接是 token 字符串）
    if (!accessToken) {
      const tokenData = await getData("/api/user/token");
      accessToken = asStr(tokenData);
    }
  }

  // 什么都没读到 → 判定为未登录/无账号信息
  if (!userId && !accessToken) return null;

  return { userId, accessToken, username, hasVoapiStore, faviconUrl };
}
