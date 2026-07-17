import type { Account } from "@/types";
import { buildCompatUserHeaders } from "./compatHeaders";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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

/**
 * 站点请求统一入口：拼 URL、组头、定 credentials、错误归一。
 * 2xx 一律返回解析后的 JSON（业务层语义由调用方解析）；
 * 非 JSON 响应（登录页/Cloudflare 拦截页）与非 2xx 统一抛 ApiError。
 */
export async function siteFetch<T = unknown>(
  account: Account,
  endpoint: string,
  options: SiteFetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildCompatUserHeaders(account.userId),
    ...options.headers,
  };
  if (account.accessToken) {
    headers.Authorization = options.rawToken
      ? account.accessToken
      : `Bearer ${account.accessToken}`;
  }

  let res: Response;
  try {
    res = await fetch(account.url + endpoint, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      credentials: account.authType === "cookie" ? "include" : "omit",
    });
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
    throw new ApiError(res.status, extractMessage(data) ?? `HTTP ${res.status}`);
  }
  return data as T;
}
