import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { ApiError } from "@/api/transport";
import { accountsItem, checkinCooldownsItem, checkinResultsItem, checkinSettingsItem } from "@/storage/items";
import type { Account } from "@/types";
import { localDayString } from "@/utils/day";
import { checkinContext, currentCheckinRecord } from "../helpers";
import { runCheckin } from "../runner";

const { siteFetch, refreshAccountBalance } = vi.hoisted(() => ({
  siteFetch: vi.fn(), refreshAccountBalance: vi.fn(),
}));
vi.mock("@/api/transport", async (original) => ({
  ...await original<typeof import("@/api/transport")>(), siteFetch,
}));
vi.mock("@/api/balance", () => ({ refreshAccountBalance }));

const account: Account = {
  id: "a", name: "测试站", url: "https://api.example.com", siteType: "new-api",
  authType: "token", userId: "12", accessToken: "token", groupId: null, tagIds: [],
  disabled: false, checkinEnabled: true, createdAt: 1, updatedAt: 1,
};
const status = (checked: boolean) => ({ success: true, data: { stats: { checked_in_today: checked } } });
const postCalls = () => siteFetch.mock.calls.filter((call) => call[2]?.method === "POST");

beforeEach(async () => {
  fakeBrowser.reset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 13, 10));
  siteFetch.mockReset();
  refreshAccountBalance.mockReset().mockResolvedValue(1);
  siteFetch.mockImplementation(async (_account, _path, options) =>
    options?.method === "POST" ? { success: true, message: "签到成功" } : status(false));
  await accountsItem.setValue([account]);
  await checkinSettingsItem.setValue({
    ...(await checkinSettingsItem.getValue()), notifyOnFinish: false, turnstileAssist: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("签到持久化与恢复", () => {
  it("写请求开始前已经持久化不含凭据的待确认记录", async () => {
    siteFetch.mockImplementation(async (_account, _path, options) => {
      if (options?.method !== "POST") return status(false);
      const record = (await checkinResultsItem.getValue()).a;
      expect(record).toMatchObject({
        uncertain: true, retryable: false, date: localDayString(), context: checkinContext(account),
      });
      expect(JSON.stringify(record)).not.toContain(account.accessToken);
      return { success: true };
    });
    const outcome = await runCheckin({ kind: "manual" });
    expect(outcome.summary.success).toBe(1);
    expect((await checkinResultsItem.getValue()).a).toMatchObject({ status: "success" });
    expect((await checkinResultsItem.getValue()).a.uncertain).toBeUndefined();
  });

  it("提交前保存失败时不发 POST，存储故障不进入自动重试", async () => {
    vi.spyOn(checkinResultsItem, "setValue").mockRejectedValueOnce(new Error("storage unavailable"));
    const outcome = await runCheckin({ kind: "daily" });
    expect(outcome).toMatchObject({ failedIds: ["a"], retryableIds: [] });
    expect(postCalls()).toHaveLength(0);
    expect((await checkinResultsItem.getValue()).a).toMatchObject({ reason: "storage", retryable: false });
  });

  it("重启留下的待确认记录只读复核，多次手动执行也不再 POST", async () => {
    await checkinResultsItem.setValue({
      a: { date: localDayString(), context: checkinContext(account), at: Date.now(), status: "failed", uncertain: true },
    });
    await runCheckin({ kind: "manual" });
    await runCheckin({ kind: "manual" });
    expect(postCalls()).toHaveLength(0);
    expect((await checkinResultsItem.getValue()).a).toMatchObject({ uncertain: true, retryable: false });
  });

  it("提交已成功但保存失败，保留预写记录，下次查询确认后清除不确定标记", async () => {
    const originalSet = checkinResultsItem.setValue.bind(checkinResultsItem);
    let writes = 0;
    vi.spyOn(checkinResultsItem, "setValue").mockImplementation(async (value) => {
      if (++writes === 2) throw new Error("保存最终结果失败");
      return originalSet(value);
    });
    let checked = false;
    siteFetch.mockImplementation(async (_account, _path, options) => {
      if (options?.method === "POST") { checked = true; return { success: true }; }
      return status(checked);
    });
    const first = await runCheckin({ kind: "daily" });
    expect(first).toMatchObject({ retryableIds: [], summary: { failed: 1 } });
    expect((await checkinResultsItem.getValue()).a.uncertain).toBe(true);
    await runCheckin({ kind: "manual" });
    expect(postCalls()).toHaveLength(1);
    expect((await checkinResultsItem.getValue()).a).toMatchObject({ status: "already_checked" });
    expect((await checkinResultsItem.getValue()).a.uncertain).toBeUndefined();
  });

  it("待确认记录查询失败时仍保留不确定标记，不进入自动重试", async () => {
    await checkinResultsItem.setValue({
      a: { date: localDayString(), context: checkinContext(account), at: Date.now(), status: "failed", uncertain: true },
    });
    siteFetch.mockRejectedValueOnce(new ApiError(500, "server down"));
    expect(await runCheckin({ kind: "daily" })).toMatchObject({ retryableIds: [] });
    expect((await checkinResultsItem.getValue()).a.uncertain).toBe(true);
  });

  it("旧版已签记录继续兼容，旧版失败不能直接进入重试执行", async () => {
    await checkinResultsItem.setValue({ a: { date: localDayString(), status: "success", at: 1 } });
    expect((await runCheckin({ kind: "manual" })).summary.already).toBe(1);
    await checkinResultsItem.setValue({ a: { date: localDayString(), status: "failed", at: 1 } });
    expect((await runCheckin({ kind: "retry" })).summary.skipped).toBe(1);
    expect(siteFetch).not.toHaveBeenCalled();
  });
});

describe("能力与用户编辑", () => {
  it("明确禁用能力被保存，自动执行跳过；手动检测恢复后保留用户开关", async () => {
    siteFetch.mockResolvedValueOnce({ success: true, data: { enabled: false } });
    await runCheckin({ kind: "daily" });
    expect((await accountsItem.getValue())[0]).toMatchObject({
      checkinEnabled: true, checkinCapability: { state: "disabled", context: checkinContext(account) },
    });
    siteFetch.mockClear();
    expect((await runCheckin({ kind: "daily" })).summary.skipped).toBe(1);
    expect(siteFetch).not.toHaveBeenCalled();
    expect((await runCheckin({ kind: "manual" })).summary.success).toBe(1);
    expect((await accountsItem.getValue())[0]).toMatchObject({ checkinEnabled: true, checkinCapability: { state: "supported" } });
  });

  it.each([{ disabled: true }, { checkinEnabled: false }, { accessToken: "new-token" }, { userId: "99" }])(
    "读取状态过程中用户编辑账号 %j 后不再提交", async (patch) => {
      siteFetch.mockImplementationOnce(async () => {
        await accountsItem.setValue([{ ...account, ...patch }]);
        return status(false);
      });
      await runCheckin({ kind: "manual" });
      expect(postCalls()).toHaveLength(0);
      expect((await accountsItem.getValue())[0]).toMatchObject(patch);
    },
  );

  it("写请求中用户换号，旧能力和旧成功不能覆盖新账号", async () => {
    siteFetch.mockImplementation(async (_account, _path, options) => {
      if (options?.method !== "POST") return status(false);
      await accountsItem.setValue([{ ...account, userId: "99", name: "新账号", accessToken: "new-token" }]);
      return { success: true };
    });
    await runCheckin({ kind: "manual" });
    const current = (await accountsItem.getValue())[0];
    expect(current).toMatchObject({ userId: "99", name: "新账号", accessToken: "new-token" });
    expect(current.checkinCapability).toBeUndefined();
    expect(currentCheckinRecord(current, (await checkinResultsItem.getValue()).a)).toBeUndefined();
    expect(refreshAccountBalance).not.toHaveBeenCalled();
  });

  it("保存结果时合并最新记录与账号，保留请求期间的其他改动", async () => {
    const other = { ...account, id: "b", url: "https://other.example.com" };
    siteFetch.mockImplementation(async (_account, _path, options) => {
      if (options?.method !== "POST") return status(false);
      await accountsItem.setValue([{ ...account, name: "新名称", checkinEnabled: false }, other]);
      await checkinResultsItem.setValue({
        ...(await checkinResultsItem.getValue()), b: { status: "success", date: localDayString(), at: 1 },
      });
      return { success: true };
    });
    await runCheckin({ kind: "manual", accountIds: ["a"] });
    expect((await checkinResultsItem.getValue()).b.status).toBe("success");
    expect((await accountsItem.getValue())[0]).toMatchObject({ name: "新名称", checkinEnabled: false });
    expect((await accountsItem.getValue()).map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("其他身份的已签记录与能力证据不能跳过当前账号", async () => {
    const oldContext = checkinContext({ ...account, userId: "99" });
    await accountsItem.setValue([{ ...account, checkinCapability: { state: "unsupported", at: 1, context: oldContext } }]);
    await checkinResultsItem.setValue({ a: { status: "success", date: localDayString(), context: oldContext, at: 1 } });
    expect((await runCheckin({ kind: "daily" })).summary.success).toBe(1);
    expect(postCalls()).toHaveLength(1);
  });
});

describe("限流等待", () => {
  it("同站点其他账号和手动操作遵守 Retry-After，其他站点继续执行", async () => {
    const until = Date.now() + 3_600_000;
    await accountsItem.setValue([account, { ...account, id: "b", userId: "13" }, { ...account, id: "c", url: "https://other.example.com" }]);
    siteFetch.mockImplementation(async (target, _path, options) => {
      if (target.id === "a") throw new ApiError(429, "slow down", undefined, until);
      return options?.method === "POST" ? { success: true } : status(false);
    });
    const result = await runCheckin({ kind: "daily" });
    expect(result).toMatchObject({ retryableIds: ["a", "b"], summary: { success: 1, failed: 2 } });
    expect(siteFetch.mock.calls.some((call) => call[0].id === "b")).toBe(false);
    expect((await checkinCooldownsItem.getValue())[account.url]).toBe(until);
    siteFetch.mockClear();
    await runCheckin({ kind: "manual", accountIds: ["a", "b"] });
    expect(siteFetch).not.toHaveBeenCalled();
  });

  it("跨午夜仍保留站点等待时刻，不因新一天而提前请求", async () => {
    vi.setSystemTime(new Date(2026, 8, 13, 23, 55));
    const until = Date.now() + 3_600_000;
    siteFetch.mockRejectedValueOnce(new ApiError(429, "slow down", undefined, until));
    await runCheckin({ kind: "daily" });
    vi.setSystemTime(new Date(2026, 8, 14, 0, 5));
    siteFetch.mockClear();
    await runCheckin({ kind: "daily" });
    expect(siteFetch).not.toHaveBeenCalled();
    expect((await checkinResultsItem.getValue()).a.retryAt).toBe(until);
  });
});
