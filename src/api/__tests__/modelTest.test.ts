import { describe, expect, it } from "vitest";
import { normalizeApiKey, parseTestOutcome, pickUsableKey } from "../modelTest";

describe("normalizeApiKey", () => {
  it("补 sk- 前缀，已有前缀不重复", () => {
    expect(normalizeApiKey("abc123")).toBe("sk-abc123");
    expect(normalizeApiKey("sk-abc123")).toBe("sk-abc123");
    expect(normalizeApiKey("  abc  ")).toBe("sk-abc");
  });
});

describe("pickUsableKey", () => {
  it("裸数组：优先 status===1", () => {
    expect(
      pickUsableKey([
        { key: "disabled", status: 2 },
        { key: "good", status: 1 },
      ]),
    ).toBe("sk-good");
  });

  it("{items} 形状同样支持", () => {
    expect(pickUsableKey({ items: [{ key: "k1", status: 1 }] })).toBe("sk-k1");
  });

  it("无 status 字段视为可用", () => {
    expect(pickUsableKey([{ key: "k1" }])).toBe("sk-k1");
  });

  it("全禁用时退回第一个有 key 的", () => {
    expect(pickUsableKey([{ key: "only", status: 3 }])).toBe("sk-only");
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
