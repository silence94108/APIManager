/** extractSessionFromPage 的返回结构（页面注入读到的原始会话信息） */
export interface PageSession {
  userId: string;
  accessToken?: string;
  username?: string;
  hasVoapiStore: boolean;
}

/**
 * 注入到中转站页面执行的函数，读取 localStorage 里的账号会话信息。
 *
 * ⚠️ 这段代码经 chrome.scripting.executeScript 序列化后在**页面上下文**运行，
 * 必须完全自包含：不能引用任何外部 import、模块级变量或闭包。所有逻辑内联。
 *
 * 返回原始会话信息；站点类型的最终判定交给页面外的 detectSiteType（可结合 title）。
 * hasVoapiStore 为 true 时基本可确定是 voapi-v2。
 */
export function extractSessionFromPage(): PageSession | null {
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
  const accessToken = voapiToken ?? asStr(user?.access_token);
  const username = asStr(user?.username);

  // 什么都没读到 → 判定为未登录/无账号信息
  if (!userId && !accessToken) return null;

  return { userId, accessToken, username, hasVoapiStore };
}
