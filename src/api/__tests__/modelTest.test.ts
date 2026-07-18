import { describe, expect, it } from "vitest";
import {
  groupByVendor,
  isFullKey,
  nextDelayMs,
  normalizeApiKey,
  PACING_PRESETS,
  parseTestOutcome,
  pickUsableKey,
  sleep,
  vendorOf,
} from "../modelTest";

describe("normalizeApiKey", () => {
  it("补 sk- 前缀，已有前缀不重复", () => {
    expect(normalizeApiKey("abc123")).toBe("sk-abc123");
    expect(normalizeApiKey("sk-abc123")).toBe("sk-abc123");
    expect(normalizeApiKey("  abc  ")).toBe("sk-abc");
  });
});

const KEY_A = "aaaabbbbccccddddeeeeffff"; // 24 位纯字母数字——最短合法完整 key
const KEY_B = "zzzzyyyyxxxxwwwwvvvvuuuu";

describe("isFullKey", () => {
  it("长串纯字母数字（含带 sk- 前缀）算完整", () => {
    expect(isFullKey(KEY_A)).toBe(true);
    expect(isFullKey(`sk-${KEY_A}`)).toBe(true);
  });

  it("打码/截断/太短的都拒绝", () => {
    expect(isFullKey("abcd****efgh")).toBe(false);
    expect(isFullKey("abcd1234")).toBe(false);
    expect(isFullKey("sk-***" + KEY_A.slice(0, 4))).toBe(false);
    expect(isFullKey("")).toBe(false);
  });
});

describe("pickUsableKey", () => {
  it("裸数组：优先 status===1", () => {
    expect(
      pickUsableKey([
        { key: KEY_B, status: 2 },
        { key: KEY_A, status: 1 },
      ]),
    ).toBe(`sk-${KEY_A}`);
  });

  it("{items} 形状同样支持", () => {
    expect(pickUsableKey({ items: [{ key: KEY_A, status: 1 }] })).toBe(`sk-${KEY_A}`);
  });

  it("无 status 字段视为可用", () => {
    expect(pickUsableKey([{ key: KEY_A }])).toBe(`sk-${KEY_A}`);
  });

  it("全禁用时退回第一个完整 key", () => {
    expect(pickUsableKey([{ key: KEY_A, status: 3 }])).toBe(`sk-${KEY_A}`);
  });

  it("打码 key 跳过，只挑完整的", () => {
    expect(
      pickUsableKey([
        { key: "abcd****efgh", status: 1 },
        { key: KEY_B, status: 1 },
      ]),
    ).toBe(`sk-${KEY_B}`);
  });

  it("全是打码 key 返回 null（宁可手填也不拿假 key 去测）", () => {
    expect(pickUsableKey([{ key: "abcd****", status: 1 }])).toBeNull();
  });

  it("空列表返回 null", () => {
    expect(pickUsableKey([])).toBeNull();
    expect(pickUsableKey(undefined)).toBeNull();
    expect(pickUsableKey({ items: [] })).toBeNull();
  });
});

describe("parseTestOutcome", () => {
  it("200 有内容 → ok，带耗时与内容摘要", () => {
    const r = parseTestOutcome(
      200,
      { choices: [{ message: { content: "你好，我是助手。" } }] },
      342,
    );
    expect(r.status).toBe("ok");
    expect(r.latencyMs).toBe(342);
    expect(r.message).toContain("你好");
  });

  it("200 空内容 → failed（路由异常/被拦截）", () => {
    expect(parseTestOutcome(200, { choices: [{ message: { content: "" } }] }, 100).status).toBe(
      "failed",
    );
    expect(parseTestOutcome(200, {}, 100).status).toBe("failed");
  });

  it("401/403 → invalid_key", () => {
    expect(parseTestOutcome(401, null, 0).status).toBe("invalid_key");
    expect(parseTestOutcome(403, null, 0).status).toBe("invalid_key");
  });

  it("429 → rate_limited", () => {
    expect(parseTestOutcome(429, null, 0).status).toBe("rate_limited");
  });

  it("404 或错误文案含 model → no_model", () => {
    expect(parseTestOutcome(404, null, 0).status).toBe("no_model");
    expect(
      parseTestOutcome(400, { error: { message: "the model gpt-x does not exist" } }, 0).status,
    ).toBe("no_model");
  });

  it("其他错误 → failed，透传站点 message", () => {
    const r = parseTestOutcome(500, { error: { message: "internal error" } }, 0);
    expect(r.status).toBe("failed");
    expect(r.message).toBe("internal error");
  });
});

describe("nextDelayMs 拟人间隔", () => {
  it("每个档位都落在预设区间内", () => {
    for (const key of Object.keys(PACING_PRESETS) as (keyof typeof PACING_PRESETS)[]) {
      const { minMs, maxMs } = PACING_PRESETS[key];
      for (let i = 0; i < 50; i++) {
        const d = nextDelayMs(key);
        expect(d).toBeGreaterThanOrEqual(minMs);
        expect(d).toBeLessThanOrEqual(maxMs);
      }
    }
  });

  it("safe 档最保守（下限不低于 normal）", () => {
    expect(PACING_PRESETS.safe.minMs).toBeGreaterThanOrEqual(PACING_PRESETS.normal.minMs);
    expect(PACING_PRESETS.normal.minMs).toBeGreaterThanOrEqual(PACING_PRESETS.fast.minMs);
  });

  it("pacing 缺失（老数据没存该字段）回退默认档，不抛错", () => {
    const { minMs, maxMs } = PACING_PRESETS.safe;
    for (let i = 0; i < 20; i++) {
      const d = nextDelayMs(undefined);
      expect(d).toBeGreaterThanOrEqual(minMs);
      expect(d).toBeLessThanOrEqual(maxMs);
    }
  });
});

describe("sleep 可取消等待", () => {
  it("正常等待后 resolve", async () => {
    await expect(sleep(10)).resolves.toBeUndefined();
  });

  it("已 abort 的 signal 立即 reject", async () => {
    const c = new AbortController();
    c.abort();
    await expect(sleep(1000, c.signal)).rejects.toThrow();
  });

  it("等待中被 abort 会 reject", async () => {
    const c = new AbortController();
    const p = sleep(1000, c.signal);
    c.abort();
    await expect(p).rejects.toThrow();
  });
});

describe("vendorOf 厂商归类", () => {
  it("常见前缀正确归类，大小写不敏感", () => {
    expect(vendorOf("claude-sonnet-5")).toBe("Anthropic");
    expect(vendorOf("Claude-Opus-4-8")).toBe("Anthropic");
    expect(vendorOf("gpt-5.5")).toBe("OpenAI");
    expect(vendorOf("o3-mini")).toBe("OpenAI");
    expect(vendorOf("gemini-2.5-pro")).toBe("Google");
    expect(vendorOf("deepseek-chat")).toBe("DeepSeek");
    expect(vendorOf("qwen-max")).toBe("通义千问");
    expect(vendorOf("grok-4")).toBe("xAI");
    expect(vendorOf("kimi-k2")).toBe("Moonshot");
    expect(vendorOf("glm-4-plus")).toBe("智谱");
  });

  it("认不出的归“其他”", () => {
    expect(vendorOf("some-random-model")).toBe("其他");
    expect(vendorOf("")).toBe("其他");
  });
});

describe("groupByVendor 分组", () => {
  it("组内保持传入顺序，组间按规则序、其他垫底", () => {
    const groups = groupByVendor([
      "unknown-x",
      "gpt-5.5",
      "claude-sonnet-5",
      "claude-opus-4-8",
      "gpt-5.4",
    ]);
    expect(groups.map((g) => g.vendor)).toEqual(["Anthropic", "OpenAI", "其他"]);
    expect(groups[0].models).toEqual(["claude-sonnet-5", "claude-opus-4-8"]);
    expect(groups[1].models).toEqual(["gpt-5.5", "gpt-5.4"]);
    expect(groups[2].models).toEqual(["unknown-x"]);
  });

  it("空列表返回空数组", () => {
    expect(groupByVendor([])).toEqual([]);
  });
});
