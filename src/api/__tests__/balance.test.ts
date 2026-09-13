import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { runCheckin } from "@/checkin/runner";
import { accountsItem, checkinResultsItem, checkinSettingsItem } from "@/storage/items";
import type { Account } from "@/types";
import { refreshAccountBalance } from "../balance";

const fetchMock = vi.fn<typeof fetch>();
const account: Account = {
  id: "balance-account", name: "测试站", url: "https://api.example.com", siteType: "new-api",
  authType: "token", userId: "12", accessToken: "test-token", groupId: null, tagIds: [],
  disabled: false, checkinEnabled: true, createdAt: 1, updatedAt: 1,
};

beforeEach(async () => {
  fakeBrowser.reset();
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("/api/log/self/stat")) return new Promise(() => {});
    const body = String(url).endsWith("/api/user/self")
      ? { success: true, data: { id: 12, quota: 1000000, used_quota: 500000 } }
      : { success: true, message: "签到成功" };
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("browser", fakeBrowser);
  await accountsItem.setValue([account]);
  await checkinSettingsItem.setValue({
    ...(await checkinSettingsItem.getValue()), notifyOnFinish: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("统计接口卡住时的余额与签到", () => {
  it("今日用量没有响应，5 秒后仍保存并返回已经取到的余额", async () => {
    const result = refreshAccountBalance(account);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await result).toBe(2);
    const saved = (await accountsItem.getValue())[0];
    expect(saved).toMatchObject({ balance: { usd: 2 }, usage: { totalUsd: 1 } });
    expect(saved.usage?.todayUsd).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("签到已成功时，后续统计卡住也会结束本轮，不让重试按钮持续转圈", async () => {
    const result = runCheckin({ kind: "manual", accountIds: [account.id] });
    await vi.advanceTimersByTimeAsync(5000);

    expect(await result).toMatchObject({ summary: { success: 1, failed: 0 }, failedIds: [] });
    expect((await checkinResultsItem.getValue())[account.id]).toMatchObject({ status: "success" });
    expect((await accountsItem.getValue())[0].balance?.usd).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
