import { describe, expect, it } from "vitest";
import { parseHm } from "@/utils/day";
import { computeDailyFireTime } from "../scheduler";

const WINDOW = { windowStart: "09:00", windowEnd: "21:00" };
const midRandom = () => 0.5;

describe("parseHm", () => {
  it("解析合法 HH:mm", () => {
    expect(parseHm("09:00")).toBe(540);
    expect(parseHm("21:30")).toBe(1290);
    expect(parseHm("0:05")).toBe(5);
  });
  it("非法输入返回 null", () => {
    expect(parseHm("24:00")).toBeNull();
    expect(parseHm("09:60")).toBeNull();
    expect(parseHm("abc")).toBeNull();
  });
});

describe("computeDailyFireTime", () => {
  it("now 在窗口前：排今天窗口内", () => {
    const now = new Date(2026, 6, 15, 7, 0);
    const when = computeDailyFireTime(WINDOW, undefined, now, midRandom);
    expect(when).toBeGreaterThanOrEqual(new Date(2026, 6, 15, 9, 0).getTime());
    expect(when).toBeLessThanOrEqual(new Date(2026, 6, 15, 21, 0).getTime());
  });

  it("now 在窗口中：随机下限是 now+60s 而非窗口起点", () => {
    const now = new Date(2026, 6, 15, 12, 0);
    const when = computeDailyFireTime(WINDOW, undefined, now, () => 0);
    expect(when).toBe(now.getTime() + 60 * 1000);
  });

  it("now 已过窗口：排明天", () => {
    const now = new Date(2026, 6, 15, 22, 0);
    const when = computeDailyFireTime(WINDOW, undefined, now, midRandom);
    expect(when).toBeGreaterThanOrEqual(new Date(2026, 6, 16, 9, 0).getTime());
    expect(when).toBeLessThanOrEqual(new Date(2026, 6, 16, 21, 0).getTime());
  });

  it("今天已跑过：排明天，即使还在今天窗口内", () => {
    const now = new Date(2026, 6, 15, 12, 0);
    const when = computeDailyFireTime(WINDOW, "2026-07-15", now, midRandom);
    expect(when).toBeGreaterThanOrEqual(new Date(2026, 6, 16, 9, 0).getTime());
  });

  it("now 恰在窗口终点前 30s：下限越界，兜底顺延一天", () => {
    const now = new Date(2026, 6, 15, 20, 59, 30);
    const when = computeDailyFireTime(WINDOW, undefined, now, midRandom);
    expect(when).toBeGreaterThanOrEqual(new Date(2026, 6, 16, 9, 0).getTime());
  });

  it("窗口配置非法时回退默认 09:00-21:00", () => {
    const now = new Date(2026, 6, 15, 7, 0);
    const when = computeDailyFireTime(
      { windowStart: "bad", windowEnd: "also-bad" },
      undefined,
      now,
      midRandom,
    );
    expect(when).toBeGreaterThanOrEqual(new Date(2026, 6, 15, 9, 0).getTime());
    expect(when).toBeLessThanOrEqual(new Date(2026, 6, 15, 21, 0).getTime());
  });
});

describe("computeDailyFireTime · fixed 模式", () => {
  const FIXED = { ...WINDOW, mode: "fixed" as const, fixedTime: "10:30" };

  it("时刻未到：排今天该时刻整点", () => {
    const now = new Date(2026, 6, 15, 8, 0);
    expect(computeDailyFireTime(FIXED, undefined, now)).toBe(
      new Date(2026, 6, 15, 10, 30).getTime(),
    );
  });

  it("已错过今天时刻且未跑：now+60s 尽快补签，而非顺延明天", () => {
    const now = new Date(2026, 6, 15, 14, 0);
    expect(computeDailyFireTime(FIXED, undefined, now)).toBe(now.getTime() + 60 * 1000);
  });

  it("今天已跑：排明天该时刻", () => {
    const now = new Date(2026, 6, 15, 8, 0);
    expect(computeDailyFireTime(FIXED, "2026-07-15", now)).toBe(
      new Date(2026, 6, 16, 10, 30).getTime(),
    );
  });

  it("now 恰在时刻前 30s：不足 60s 缓冲，落到 now+60s", () => {
    const now = new Date(2026, 6, 15, 10, 29, 30);
    expect(computeDailyFireTime(FIXED, undefined, now)).toBe(now.getTime() + 60 * 1000);
  });

  it("fixedTime 非法时回退 09:00", () => {
    const now = new Date(2026, 6, 15, 7, 0);
    expect(
      computeDailyFireTime({ ...WINDOW, mode: "fixed", fixedTime: "bad" }, undefined, now),
    ).toBe(new Date(2026, 6, 15, 9, 0).getTime());
  });
});
