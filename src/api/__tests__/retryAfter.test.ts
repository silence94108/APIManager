import { describe, expect, it } from "vitest";
import { parseRetryAfter } from "../retryAfter";

describe("Retry-After", () => {
  const now = Date.UTC(2026, 8, 13, 10);

  it.each([["120", 120_000], [" 30 ", 30_000], ["0.5", 500], ["0", 0]])(
    "解析秒数 %s", (header, delay) => {
      expect(parseRetryAfter(header, now)).toBe(now + delay);
    },
  );

  it("解析 HTTP 日期，并保留跨午夜的服务器等待时间", () => {
    const until = Date.UTC(2026, 8, 14, 12);
    expect(parseRetryAfter(new Date(until).toUTCString(), now)).toBe(until);
  });

  it.each([null, "", "invalid", "-1", "99999999999999999999999999"])(
    "无效值 %s 至少等待一分钟", (header) => {
      expect(parseRetryAfter(header, now)).toBe(now + 60_000);
    },
  );
});
