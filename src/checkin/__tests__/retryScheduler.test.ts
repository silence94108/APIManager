import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { accountsItem, checkinCooldownsItem, checkinResultsItem, checkinSettingsItem, schedulerStateItem } from "@/storage/items";
import type { Account, AccountCheckinRecord, ProviderResult, RunOutcome } from "@/types";
import { localDayString } from "@/utils/day";
import { checkinContext } from "../helpers";
import { DAILY_ALARM, ensureScheduled, handleAlarm, RETRY_ALARM } from "../scheduler";

const { runCheckin } = vi.hoisted(() => ({ runCheckin: vi.fn() }));
vi.mock("../runner", () => ({ runCheckin }));
const account: Account = {
  id: "a", name: "测试站", url: "https://api.example.com", siteType: "new-api",
  authType: "token", userId: "12", accessToken: "token", groupId: null, tagIds: [],
  disabled: false, checkinEnabled: true, createdAt: 1, updatedAt: 1,
};
const temporary: ProviderResult = { status: "failed", reason: "server", retryable: true };
const summary = { success: 0, already: 0, failed: 1, skipped: 0, needsVerify: 0 };

async function record(id: string, result: ProviderResult): Promise<void> {
  const target = (await accountsItem.getValue()).find((a) => a.id === id)!;
  await checkinResultsItem.setValue({
    ...(await checkinResultsItem.getValue()),
    [id]: { ...result, date: localDayString(), context: checkinContext(target), at: Date.now() },
  });
}

beforeEach(async () => {
  fakeBrowser.reset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 13, 10));
  await accountsItem.setValue([account]);
  await checkinSettingsItem.setValue({
    ...(await checkinSettingsItem.getValue()), autoEnabled: true, retryEnabled: true,
  });
  runCheckin.mockReset().mockImplementation(async () => {
    await record("a", temporary);
    return { summary, failedIds: ["a"], retryableIds: ["a"] } satisfies RunOutcome;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("签到重试调度", () => {
  it("旧版 outcome 只有 failedIds 时不默认安排重试", async () => {
    runCheckin.mockImplementationOnce(async () => {
      await record("a", temporary);
      return { summary, failedIds: ["a"] };
    });
    await handleAlarm({ name: DAILY_ALARM });
    expect((await schedulerStateItem.getValue()).retry).toBeUndefined();
  });

  it.each([
    { status: "failed", reason: "authentication", retryable: false },
    { status: "failed", reason: "permission", retryable: false },
    { status: "failed", reason: "unsupported", retryable: false },
    { status: "failed", reason: "invalid_response", retryable: false },
    { status: "failed", reason: "storage", retryable: false },
    { status: "failed", reason: "uncertain", retryable: true, uncertain: true },
    { status: "needs_verification", retryable: true },
  ] satisfies ProviderResult[])("即使 outcome 误列可重试，也过滤不可重试的最新记录：%j", async (result) => {
    runCheckin.mockImplementationOnce(async () => {
      await record("a", result);
      return { summary, failedIds: ["a"], retryableIds: ["a"] };
    });
    await handleAlarm({ name: DAILY_ALARM });
    expect((await schedulerStateItem.getValue()).retry).toBeUndefined();
  });

  it("临时故障至少等待 30 分钟，首轮加两次重试后停止", async () => {
    const initial = Date.now();
    await handleAlarm({ name: DAILY_ALARM });
    expect((await schedulerStateItem.getValue()).nextRetryAt).toBe(initial + 1_800_000);
    expect((await schedulerStateItem.getValue()).retry?.attempts.a).toBe(1);
    vi.setSystemTime(initial + 1_800_000);
    await handleAlarm({ name: RETRY_ALARM });
    expect((await schedulerStateItem.getValue()).retry?.attempts.a).toBe(2);
    vi.setSystemTime(initial + 3_600_000);
    await handleAlarm({ name: RETRY_ALARM });
    expect(runCheckin).toHaveBeenCalledTimes(3);
    expect((await schedulerStateItem.getValue()).retry).toBeUndefined();
  });

  it("闹钟提前触发时不发请求，也不消耗次数", async () => {
    const initial = Date.now();
    await handleAlarm({ name: DAILY_ALARM });
    vi.setSystemTime(initial + 60_000);
    await handleAlarm({ name: RETRY_ALARM });
    expect(runCheckin).toHaveBeenCalledTimes(1);
    expect((await schedulerStateItem.getValue()).retry?.attempts.a).toBe(1);
    expect((await schedulerStateItem.getValue()).nextRetryAt).toBe(initial + 1_800_000);
  });

  it("按账号分别等待，仅执行到期项，保留仍在限流的其他账号", async () => {
    const initial = Date.now();
    const other = { ...account, id: "b", url: "https://other.example.com" };
    await accountsItem.setValue([account, other]);
    runCheckin.mockImplementationOnce(async () => {
      await record("a", temporary);
      await record("b", { ...temporary, reason: "rate_limited", retryAt: initial + 3_600_000 });
      return { summary, failedIds: ["a", "b"], retryableIds: ["a", "b"] };
    });
    await handleAlarm({ name: DAILY_ALARM });
    expect((await schedulerStateItem.getValue()).retry?.notBefore).toEqual({
      a: initial + 1_800_000, b: initial + 3_600_000,
    });
    vi.setSystemTime(initial + 1_800_000);
    runCheckin.mockImplementationOnce(async ({ accountIds }) => {
      expect(accountIds).toEqual(["a"]);
      // 请求之前已持久化本次计数，后台中断也不会多送一次。
      expect((await schedulerStateItem.getValue()).retry?.attempts.a).toBe(2);
      await record("a", { status: "success" });
      return { summary, failedIds: [], retryableIds: [] };
    });
    await handleAlarm({ name: RETRY_ALARM });
    const state = await schedulerStateItem.getValue();
    expect(state.retry?.pendingIds).toEqual(["b"]);
    expect(state.retry?.attempts.b).toBe(1);
    expect(state.nextRetryAt).toBe(initial + 3_600_000);
  });

  it.each(["deleted", "disabled", "checkin_off", "changed_identity", "already_checked", "permanent"])(
    "执行前过滤已发生变化的待重试项：%s", async (change) => {
      const initial = Date.now();
      await handleAlarm({ name: DAILY_ALARM });
      if (change === "deleted") await accountsItem.setValue([]);
      if (change === "disabled") await accountsItem.setValue([{ ...account, disabled: true }]);
      if (change === "checkin_off") await accountsItem.setValue([{ ...account, checkinEnabled: false }]);
      if (change === "changed_identity") await accountsItem.setValue([{ ...account, userId: "99" }]);
      if (change === "already_checked") await record("a", { status: "already_checked" });
      if (change === "permanent") await record("a", { status: "failed", reason: "authentication", retryable: false });
      vi.setSystemTime(initial + 1_800_000);
      await handleAlarm({ name: RETRY_ALARM });
      expect(runCheckin).toHaveBeenCalledTimes(1);
      expect((await schedulerStateItem.getValue()).retry).toBeUndefined();
    },
  );

  it("关闭自动签到或重试设置后陈旧闹钟不再运行", async () => {
    await handleAlarm({ name: DAILY_ALARM });
    await checkinSettingsItem.setValue({ ...(await checkinSettingsItem.getValue()), autoEnabled: false });
    await handleAlarm({ name: RETRY_ALARM });
    await handleAlarm({ name: DAILY_ALARM });
    expect(runCheckin).toHaveBeenCalledTimes(1);
    expect((await schedulerStateItem.getValue()).retry).toBeUndefined();
  });

  it("扩展重启恢复队列，保留最早请求时刻", async () => {
    const initial = Date.now();
    await handleAlarm({ name: DAILY_ALARM });
    vi.setSystemTime(initial + 300_000);
    await ensureScheduled();
    expect((await schedulerStateItem.getValue()).nextRetryAt).toBe(initial + 1_800_000);
    expect(runCheckin).toHaveBeenCalledTimes(1);
  });

  it("同源站点的限流可延后已入队账号，恢复时也不提前", async () => {
    const initial = Date.now();
    await handleAlarm({ name: DAILY_ALARM });
    await checkinCooldownsItem.setValue({ [account.url]: initial + 7_200_000 });
    await ensureScheduled();
    expect((await schedulerStateItem.getValue()).nextRetryAt).toBe(initial + 7_200_000);
  });

  it("跨午夜的 Retry-After 不排本日重试，持久化限流仍保留", async () => {
    vi.setSystemTime(new Date(2026, 8, 13, 23, 10));
    const until = Date.now() + 7_200_000;
    runCheckin.mockImplementationOnce(async () => {
      await record("a", { ...temporary, reason: "rate_limited", retryAt: until });
      await checkinCooldownsItem.setValue({ [account.url]: until });
      return { summary, failedIds: ["a"], retryableIds: ["a"] };
    });
    await handleAlarm({ name: DAILY_ALARM });
    expect((await schedulerStateItem.getValue()).retry).toBeUndefined();
    expect((await checkinCooldownsItem.getValue())[account.url]).toBe(until);
  });

  it("休眠后跨日的旧重试闹钟直接清除", async () => {
    await handleAlarm({ name: DAILY_ALARM });
    vi.setSystemTime(new Date(2026, 8, 14, 10));
    await handleAlarm({ name: RETRY_ALARM });
    expect(runCheckin).toHaveBeenCalledTimes(1);
    expect((await schedulerStateItem.getValue()).retry).toBeUndefined();
  });

  it("旧失败记录缺少可重试标记时，启动恢复也清除旧队列", async () => {
    const legacy: AccountCheckinRecord = { date: localDayString(), at: Date.now(), status: "failed" };
    await checkinResultsItem.setValue({ a: legacy });
    await schedulerStateItem.setValue({ retry: { day: localDayString(), pendingIds: ["a"], attempts: { a: 1 } } });
    await ensureScheduled();
    expect((await schedulerStateItem.getValue()).retry).toBeUndefined();
  });
});
