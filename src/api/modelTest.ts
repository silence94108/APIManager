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

/**
 * 完整 key 校验：不少面板在列表接口里返回打码/截断的 key（如 "abcd****"、只留末几位），
 * 拿去测活必然 401 还污染手填框。new-api 系真实裸 key 是长串纯字母数字（通常 48 位），
 * 这里要求 ≥24 位纯字母数字才认为完整。
 */
export function isFullKey(key: string): boolean {
  const bare = key.trim().replace(/^sk-/, "");
  return /^[A-Za-z0-9]{24,}$/.test(bare);
}

/** 从令牌列表里挑一个可用 key：兼容裸数组与 {items} 两种响应形状，只要完整 key，优先 status===1 */
export function pickUsableKey(data: TokenListEnvelope["data"]): string | null {
  const list = Array.isArray(data) ? data : (data?.items ?? []);
  const full = list.filter((t) => t.key && isFullKey(t.key));
  const enabled = full.filter((t) => t.status === undefined || t.status === 1);
  const chosen = (enabled[0] ?? full[0])?.key;
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

/**
 * 按模型名前缀归类厂商——中转站模型名不带显式厂商字段，只能按命名习惯推断。
 * 顺序敏感：先匹配到的先赢，所以更专有的前缀要排在更泛的前面。
 */
const VENDOR_RULES: { label: string; test: (id: string) => boolean }[] = [
  { label: "Anthropic", test: (m) => m.startsWith("claude") },
  { label: "OpenAI", test: (m) => /^(gpt|o1|o3|o4|chatgpt|text-|dall-e|whisper|tts|davinci)/.test(m) },
  { label: "Google", test: (m) => /^(gemini|gemma|palm|bison|imagen)/.test(m) },
  { label: "DeepSeek", test: (m) => m.startsWith("deepseek") },
  { label: "通义千问", test: (m) => /^(qwen|qwq|tongyi)/.test(m) },
  { label: "xAI", test: (m) => m.startsWith("grok") },
  { label: "Moonshot", test: (m) => /^(moonshot|kimi)/.test(m) },
  { label: "智谱", test: (m) => /^(glm|chatglm|codegeex)/.test(m) },
  { label: "Meta", test: (m) => /^(llama|codellama)/.test(m) },
  { label: "Mistral", test: (m) => /^(mistral|mixtral|codestral|ministral)/.test(m) },
  { label: "字节豆包", test: (m) => /^(doubao|ep-|skylark)/.test(m) },
  { label: "百度文心", test: (m) => /^(ernie|wenxin)/.test(m) },
  { label: "MiniMax", test: (m) => /^(abab|minimax)/.test(m) },
  { label: "百川", test: (m) => m.startsWith("baichuan") },
  { label: "零一万物", test: (m) => m.startsWith("yi-") },
  { label: "Cohere", test: (m) => /^(command|c4ai)/.test(m) },
];

const VENDOR_OTHER = "其他";

/** 单个模型名 → 厂商标签（不认识归"其他"）。大小写不敏感。 */
export function vendorOf(model: string): string {
  const id = model.trim().toLowerCase();
  return VENDOR_RULES.find((r) => r.test(id))?.label ?? VENDOR_OTHER;
}

export interface VendorGroup {
  vendor: string;
  models: string[];
}

/**
 * 把模型列表按厂商分组。组内保持传入顺序，组间按 VENDOR_RULES 顺序、"其他"垫底。
 * 供 UI 折叠分组展示与整组勾选。
 */
export function groupByVendor(models: string[]): VendorGroup[] {
  const buckets = new Map<string, string[]>();
  for (const m of models) {
    const v = vendorOf(m);
    (buckets.get(v) ?? buckets.set(v, []).get(v)!).push(m);
  }
  const order = [...VENDOR_RULES.map((r) => r.label), VENDOR_OTHER];
  return [...buckets.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([vendor, list]) => ({ vendor, models: list }));
}

export type ModelTestStatus = "ok" | "invalid_key" | "no_model" | "rate_limited" | "failed";

export interface ModelTestOutcome {
  status: ModelTestStatus;
  /** ok 时的首字耗时（ms）——流式下收到首个内容片段的时间；非流式兜底时为整个响应耗时 */
  latencyMs?: number;
  /** ok 时返回内容前 80 字，或失败原因 */
  message?: string;
  /** 本次实际发出的问题（含随机暗号），供结果表直接展示 */
  prompt?: string;
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
      return { status: "ok", latencyMs, message: content.slice(0, 80) };
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

/** 自然问题池——避免同一句式重复发出显得像脚本，每次随机挑一条 */
const PROMPT_POOL = [
  "你好，用一句话介绍下你自己吧",
  "简单说说你能帮我做什么？",
  "用一句话打个招呼吧",
  "嗨，你现在方便聊天吗？",
  "帮我想一句简短的问候语",
  "用一句话总结你的特点",
  "你好呀，最近怎么样？",
  "一句话告诉我今天适合做点什么",
];

function randomPrompt(): string {
  const base = PROMPT_POOL[Math.floor(Math.random() * PROMPT_POOL.length)];
  // 附一个隐蔽暗号，确保内容唯一、绕开缓存，但读起来仍自然
  return `${base}（${randomTag()}）`;
}

/**
 * 测试节奏档位——每次请求之间的随机等待区间（毫秒）。
 * 关键反封号措施：真人问完一条会读回复、思考，请求间隔是秒级且不规律的；
 * 零间隔连发会被站点风控识别为脚本。默认最保守档。
 */
export const PACING_PRESETS = {
  fast: { label: "适中（4~10 秒）", minMs: 4_000, maxMs: 10_000 },
  normal: { label: "稳健（8~20 秒）", minMs: 8_000, maxMs: 20_000 },
  safe: { label: "保守（15~40 秒）", minMs: 15_000, maxMs: 40_000 },
} as const;

export type PacingKey = keyof typeof PACING_PRESETS;
export const DEFAULT_PACING: PacingKey = "safe";

/** 在档位区间内取一个随机等待时长（毫秒）；老数据没存 pacing 时回退默认档 */
export function nextDelayMs(pacing: PacingKey | undefined): number {
  const { minMs, maxMs } = PACING_PRESETS[pacing ?? DEFAULT_PACING] ?? PACING_PRESETS[DEFAULT_PACING];
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

/** 可取消的等待：sleep(ms)，signal abort 时提前 reject */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * 首字超时：从发起请求到收到首个内容片段的最长等待。
 * 中转站「渠道失败→自动换渠道重试」+ 慢模型排队，1~2 分钟才出首字并不罕见，
 * 30s 会把「慢但活着」误判成失败——而站点侧照样跑完并计费。
 */
export const FIRST_TOKEN_TIMEOUT_MS = 120_000;

/** SSE 事件行解析：data 行 → 内容片段 / 流内错误 / 结束标记；其余行（心跳、空行、坏 JSON、空 delta）返回 null */
export function parseSseLine(
  line: string,
): { content?: string; error?: string; done?: boolean } | null {
  const l = line.trim();
  if (!l.startsWith("data:")) return null;
  const payload = l.slice(5).trim();
  if (payload === "[DONE]") return { done: true };
  try {
    const j = JSON.parse(payload) as {
      choices?: { delta?: { content?: string; reasoning_content?: string } }[];
      error?: { message?: string };
    };
    if (j.error) return { error: j.error.message ?? "流内返回错误" };
    const delta = j.choices?.[0]?.delta;
    // 思考型模型可能先吐 reasoning——也证明模型活着在生成
    const content = delta?.content || delta?.reasoning_content || "";
    return content ? { content } : null;
  } catch {
    return null;
  }
}

/**
 * 真实测活：向 {origin}/v1/chat/completions 发一条随机化短对话（流式），用 sk- key 鉴权。
 * 收到首个内容片段即判定可用并断开连接——不等全文，省输出额度；latencyMs 记的是首字耗时。
 * 渠道无视 stream 直接回整段 JSON 时，按非流式解析兜底。
 */
export async function testModel(
  origin: string,
  apiKey: string,
  model: string,
): Promise<ModelTestOutcome> {
  const prompt = randomPrompt();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIRST_TOKEN_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120,
        stream: true,
      }),
      signal: controller.signal,
    });

    const isSse = (res.headers.get("content-type") ?? "").includes("text/event-stream");
    if (res.status !== 200 || !isSse) {
      // 非 200 错误，或渠道无视 stream 回了整段 JSON——走原非流式判定
      const latencyMs = Date.now() - startedAt;
      let body: ChatCompletionResponse | null = null;
      try {
        body = (await res.json()) as ChatCompletionResponse;
      } catch {
        // 非 JSON（登录页/CF 拦截页等）——归失败
        if (res.status === 200) return { status: "failed", message: "响应非 JSON（可能被拦截）", prompt };
      }
      return { ...parseTestOutcome(res.status, body, latencyMs), prompt };
    }

    const reader = res.body?.getReader();
    if (!reader) return { status: "failed", message: "响应流不可读", prompt };
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const ev = parseSseLine(line);
        if (!ev) continue;
        if (ev.content) {
          // 模型真的在吐字——判定可用，立刻断开（站点侧一般会随之取消上游生成）
          const latencyMs = Date.now() - startedAt;
          controller.abort();
          return { status: "ok", latencyMs, message: ev.content.slice(0, 80), prompt };
        }
        if (ev.error) {
          controller.abort();
          return { status: "failed", message: ev.error, prompt };
        }
        if (ev.done) {
          controller.abort();
          return { status: "failed", message: "返回内容为空（可能被拦截或路由异常）", prompt };
        }
      }
    }
    return { status: "failed", message: "返回内容为空（可能被拦截或路由异常）", prompt };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return {
        status: "failed",
        message: `等待首字超时（${FIRST_TOKEN_TIMEOUT_MS / 1000}s 无回包）`,
        prompt,
      };
    }
    return { status: "failed", message: e instanceof Error ? e.message : String(e), prompt };
  } finally {
    clearTimeout(timer);
  }
}
