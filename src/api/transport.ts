import type { Account, NewApiSessionAuth } from "@/types";
import { buildCompatUserHeaders } from "./compatHeaders";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 站点开启了 Cloudflare 人机验证（Turnstile / JS Challenge）拦下了本次请求。
 * 单列一类（继承 ApiError，不破坏既有 instanceof 判断），供上层归入"待验证"
 * 而非"失败"——引导用户到站点页面完成验证，不做静默绕过。
 */
export class VerificationRequiredError extends ApiError {
  constructor(status: number, message = "站点开启了人机验证，请在站点页面完成验证后重试") {
    super(status, message);
    this.name = "VerificationRequiredError";
  }
}

export interface SiteFetchOptions {
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  /** voapi-v2：Authorization 直接放 JWT，不加 Bearer 前缀 */
  rawToken?: boolean;
}

function extractMessage(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.message === "string" && d.message) return d.message;
    if (typeof d.msg === "string" && d.msg) return d.msg;
  }
  return undefined;
}

/** 普通业务请求与会话刷新共用的 HTTP / JSON / Cloudflare 错误处理。 */
async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new ApiError(0, `网络请求失败：${e instanceof Error ? e.message : String(e)}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  // Cloudflare 人机验证挑战：cf-mitigated:challenge（现代 Turnstile 托管挑战），
  // 或经 Cloudflare（有 cf-ray）返回 403/503 的非 JSON 挑战页。单独归类交上层引导。
  const isCfChallenge =
    res.headers.get("cf-mitigated") === "challenge" ||
    (!!res.headers.get("cf-ray") &&
      (res.status === 403 || res.status === 503) &&
      !contentType.includes("json"));
  if (isCfChallenge) {
    throw new VerificationRequiredError(res.status);
  }

  if (!contentType.includes("json")) {
    throw new ApiError(
      res.status,
      "站点返回了非 JSON 响应（可能未登录或被 Cloudflare 拦截）",
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(res.status, "站点响应 JSON 解析失败");
  }

  if (!res.ok) {
    const code = data && typeof data === "object" ? (data as Record<string, unknown>).code : undefined;
    throw new ApiError(
      res.status,
      extractMessage(data) ?? `HTTP ${res.status}`,
      typeof code === "string" ? code : undefined,
    );
  }
  return data as T;
}

interface SessionToken {
  accessToken: string;
  sessionAuth: NewApiSessionAuth;
}

interface SessionRefreshResponse {
  success?: boolean;
  data?: {
    access_token?: string;
    token_type?: string;
    access_expires_at?: number;
    user?: { id?: number };
    session?: { sid?: string; current?: boolean };
  };
}

// 只缓存当前运行期间的短期令牌，不改写账号列表，避免并行刷新余额时覆盖其他账号的数据。
const sessionTokens = new Map<string, SessionToken>();
const sessionRefreshes = new Map<string, Promise<SessionToken>>();

async function getSessionToken(account: Account, rejectedToken?: string): Promise<SessionToken> {
  const sessionAuth = account.sessionAuth!;
  const key = JSON.stringify([account.url, account.userId, sessionAuth.sessionId]);
  let current = sessionTokens.get(key);
  if (account.accessToken && (!current || sessionAuth.accessExpiresAt > current.sessionAuth.accessExpiresAt)) {
    current = { accessToken: account.accessToken, sessionAuth };
  }
  if (
    current && current.accessToken !== rejectedToken &&
    current.sessionAuth.accessExpiresAt > Date.now() / 1000 + 60
  ) return current;

  const pending = sessionRefreshes.get(key);
  if (pending) return pending;

  const refresh = async (): Promise<SessionToken> => {
    if (!sessionAuth.sessionId || !account.userId) {
      throw new ApiError(401, "登录会话信息不完整，请在站点登录后重新识别账号");
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let response: SessionRefreshResponse;
      try {
        response = await fetchJson<SessionRefreshResponse>(account.url + "/api/user/auth/refresh", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache, no-store",
            // 绑定原会话：浏览器切换账号后不能把另一账号的令牌写入当前账号。
            "X-Auth-Session": sessionAuth.sessionId,
          },
          credentials: "include",
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof VerificationRequiredError) throw error;
        if (error instanceof ApiError) {
          if (error.status === 409 && error.code === "AUTH_REFRESH_RACE" && attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, [100, 250, 500][attempt]));
            continue;
          }
          if (error.status === 401 || error.code === "AUTH_SESSION_MISMATCH") {
            throw new ApiError(error.status, "站点登录已失效或已切换账号，请登录后重新识别", error.code);
          }
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
      const data = response?.data;
      const token = typeof data?.access_token === "string" ? data.access_token.trim() : "";
      const sid = typeof data?.session?.sid === "string" ? data.session.sid.trim() : "";
      const refreshedUserId = data?.user?.id;
      if (
        response?.success !== true || !token || !sid || data?.token_type !== "Bearer" ||
        data.session?.current !== true || typeof refreshedUserId !== "number" ||
        !Number.isSafeInteger(refreshedUserId) || refreshedUserId <= 0 ||
        typeof data.access_expires_at !== "number" || !Number.isFinite(data.access_expires_at) ||
        data.access_expires_at <= Date.now() / 1000
      ) throw new ApiError(401, "站点未返回有效登录会话，请登录后重新识别");
      if (sid !== sessionAuth.sessionId || String(refreshedUserId) !== account.userId) {
        throw new ApiError(409, "浏览器当前登录账号或会话已变更，请回到站点重新识别");
      }
      const result: SessionToken = {
        accessToken: token,
        sessionAuth: { sessionId: sid, accessExpiresAt: data.access_expires_at },
      };
      sessionTokens.set(key, result);
      return result;
    }
    throw new ApiError(409, "站点正在刷新登录会话，请稍后重试");
  };
  const request = refresh();
  sessionRefreshes.set(key, request);
  try {
    return await request;
  } finally {
    sessionRefreshes.delete(key);
  }
}

/**
 * 站点请求统一入口：拼 URL、认证头与 Cookie 策略，并统一错误。
 * 新版 New API 访问令牌临近过期时恢复同一浏览器会话；401 最多续期并重试一次。
 */
export async function siteFetch<T = unknown>(
  account: Account,
  endpoint: string,
  options: SiteFetchOptions = {},
): Promise<T> {
  const session = account.sessionAuth ? await getSessionToken(account) : undefined;
  const request = (accessToken: string | undefined): Promise<T> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...buildCompatUserHeaders(account.userId),
      ...options.headers,
    };
    if (accessToken) headers.Authorization = options.rawToken ? accessToken : `Bearer ${accessToken}`;
    return fetchJson<T>(account.url + endpoint, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      credentials: account.authType === "cookie" && !session ? "include" : "omit",
    });
  };
  try {
    return await request(session?.accessToken ?? account.accessToken);
  } catch (error) {
    if (error instanceof VerificationRequiredError) throw error;
    if (!session || !(error instanceof ApiError) || error.status !== 401) throw error;
    const renewed = await getSessionToken(account, session.accessToken);
    return request(renewed.accessToken);
  }
}
