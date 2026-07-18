import type { Account } from "@/types";
import { siteFetch } from "./transport";

/**
 * 站点令牌（/api/token 列表项，new-api 系）。key 通常不带 sk- 前缀，status 1 为启用。
 */
interface SiteToken {
  key?: string;
  status?: number;
  name?: string;
}

interface TokenListEnvelope {
  data?: SiteToken[] | { items?: SiteToken[] };
}

interface ModelsEnvelope {
  data?: string[];
}

/** key 归一：补 sk- 前缀（站点返回的裸 key 不含前缀，对话鉴权需要完整 sk-xxx） */
export function normalizeApiKey(key: string): string {
  const k = key.trim();
  return k.startsWith("sk-") ? k : `sk-${k}`;
}

/** 从令牌列表里挑一个可用 key：兼容裸数组与 {items} 两种响应形状，优先 status===1 */
export function pickUsableKey(data: TokenListEnvelope["data"]): string | null {
  const list = Array.isArray(data) ? data : (data?.items ?? []);
  const enabled = list.filter((t) => t.key && (t.status === undefined || t.status === 1));
  const chosen = (enabled[0] ?? list.find((t) => t.key))?.key;
  return chosen ? normalizeApiKey(chosen) : null;
}

/** 用系统令牌拉该账号的第一个可用 API Key（new-api 系 /api/token）；无则返回 null */
export async function fetchFirstApiKey(account: Account): Promise<string | null> {
  const res = await siteFetch<TokenListEnvelope>(account, "/api/token/?p=0&size=100");
  return pickUsableKey(res.data);
}

/** 拉站点可用模型 id 列表（系统令牌，便宜；失败抛错交上层） */
export async function fetchSiteModels(account: Account): Promise<string[]> {
  const res = await siteFetch<ModelsEnvelope>(account, "/api/user/models");
  return Array.isArray(res.data) ? res.data.filter((m) => typeof m === "string") : [];
}

export type ModelTestStatus = "ok" | "invalid_key" | "no_model" | "rate_limited" | "failed";

export interface ModelTestOutcome {
  status: ModelTestStatus;
  /** ok 时的往返耗时（ms） */
  latencyMs?: number;
  /** ok 时返回内容前 50 字，或失败原因 */
  message?: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  error?: { message?: string; code?: string };
  message?: string;
}

/**
 * 判定纯函数：HTTP 状态 + 响应体 → 测试结论。独立导出供单测。
 * 200 且有实际内容才算真可用；据状态码与错误文案归类失败原因。
 */
export function parseTestOutcome(
  status: number,
  body: ChatCompletionResponse | null,
  latencyMs: number,
): ModelTestOutcome {
  if (status === 200) {
    const content = body?.choices?.[0]?.message?.content?.trim();
    if (content) {
      return { status: "ok", latencyMs, message: content.slice(0, 50) };
    }
    return { status: "failed", message: "返回内容为空（可能被拦截或路由异常）" };
  }

  const errMsg = body?.error?.message ?? body?.message ?? `HTTP ${status}`;
  if (status === 401 || status === 403) return { status: "invalid_key", message: "API Key 无效或无权限" };
  if (status === 429) return { status: "rate_limited", message: "被限流，请稍后重试" };
  if (status === 404 || /model|不存在|not found|no such/i.test(errMsg)) {
    return { status: "no_model", message: "站点无此模型或未开通" };
  }
  return { status: "failed", message: errMsg };
}

/** 每次不同的暗号，防止固定内容被站点缓存命中造成"假可用" */
function randomTag(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * 真实测活：向 {origin}/v1/chat/completions 发一条随机化短对话，用 sk- key 鉴权。
 * 不发 max_tokens:1 探针——像正常流量，避免被站点判定为测活。30s 超时。
 */
export async function testModel(
  origin: string,
  apiKey: string,
  model: string,
): Promise<ModelTestOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const startedAt = Date.now();
  try {
    const res = await fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "user", content: `你好，请用一句话介绍你自己（暗号 ${randomTag()}）。` },
        ],
        max_tokens: 120,
        stream: false,
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;

    let body: ChatCompletionResponse | null = null;
    try {
      body = (await res.json()) as ChatCompletionResponse;
    } catch {
      // 非 JSON（登录页/CF 拦截页等）——归失败
      if (res.status === 200) return { status: "failed", message: "响应非 JSON（可能被拦截）" };
    }
    return parseTestOutcome(res.status, body, latencyMs);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { status: "failed", message: "请求超时（30s）" };
    }
    return { status: "failed", message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
