import { describe, expect, it } from "vitest";
import { localDayString, localMonthString } from "../day";
import { formatUsd, quotaToUsd } from "../quota";
import { isValidSiteUrl, normalizeOrigin } from "../url";

describe("day", () => {
  it("localDayString 输出本地日期，不受 UTC 影响", () => {
    // 本地 2026-07-15 23:30 —— 若走 UTC 序列化，东八区会得到 07-15 之外的日期
    const d = new Date(2026, 6, 15, 23, 30);
    expect(localDayString(d)).toBe("2026-07-15");
    expect(localMonthString(d)).toBe("2026-07");
  });

  it("个位数月份/日期补零", () => {
    expect(localDayString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("url", () => {
  it("补协议、去路径尾斜杠，只留 origin", () => {
    expect(normalizeOrigin("api.example.com")).toBe("https://api.example.com");
    expect(normalizeOrigin("https://api.example.com/console/")).toBe(
      "https://api.example.com",
    );
    expect(normalizeOrigin("http://localhost:3000/x")).toBe("http://localhost:3000");
  });

  it("非法输入返回 false", () => {
    expect(isValidSiteUrl("ht tp://x")).toBe(false);
    expect(isValidSiteUrl("")).toBe(false);
  });
});

describe("quota", () => {
  it("500000 quota = 1 USD", () => {
    expect(quotaToUsd(500000)).toBe(1);
    expect(quotaToUsd(250000)).toBe(0.5);
  });

  it("formatUsd 千分位 + 两位小数", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
