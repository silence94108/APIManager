import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/types";
import { assistTurnstileCheckin } from "../turnstileAssist";

const { create, remove, get, executeScript, checkIn, onUpdated } = vi.hoisted(() => ({
  create: vi.fn(), remove: vi.fn(), get: vi.fn(), executeScript: vi.fn(), checkIn: vi.fn(),
  onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
}));
vi.mock("wxt/browser", () => ({
  browser: { windows: { create, remove }, tabs: { get, onUpdated }, scripting: { executeScript } },
}));
vi.mock("../providers", () => ({ getProvider: () => ({ checkIn }) }));

const account: Account = {
  id: "a", name: "测试站", url: "https://api.example.com", siteType: "new-api",
  authType: "token", userId: "12", accessToken: "token", groupId: null, tagIds: [],
  disabled: false, checkinEnabled: true, createdAt: 1, updatedAt: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  create.mockResolvedValue({ id: 7, tabs: [{ id: 42 }] });
  remove.mockResolvedValue(undefined);
  get.mockResolvedValue({ id: 42, status: "complete", url: account.url + "/console/personal" });
  executeScript.mockImplementation(async ({ func, args }) => [{
    result: func.name === "extractSessionFromPage" ? { userId: "12" } : args[0] ? "clicked" : "found",
  }]);
  checkIn.mockResolvedValue({ status: "already_checked" });
});
afterEach(() => vi.useRealTimers());

describe("辅助点击后的只读复核", () => {
  it("核验页面身份、保存日志后才点击，点击后仅调用只读核对", async () => {
    const beforeSubmit = vi.fn(async () => {});
    executeScript.mockImplementation(async ({ func, args }) => {
      if (func.name === "extractSessionFromPage") return [{ result: { userId: "12" } }];
      if (args[0]) expect(beforeSubmit).toHaveBeenCalledTimes(1);
      return [{ result: args[0] ? "clicked" : "found" }];
    });
    const task = assistTurnstileCheckin(account, { beforeSubmit });
    await vi.runAllTimersAsync();
    expect(await task).toMatchObject({ status: "success", capability: "supported" });
    expect(checkIn).toHaveBeenCalledExactlyOnceWith(account, { reconcileOnly: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(7);
  });

  it("已点击但未确认时保留不确定，不再打开下一候选页", async () => {
    checkIn.mockResolvedValue({ status: "failed", uncertain: true, retryable: false, retryAt: Date.now() + 60_000 });
    const task = assistTurnstileCheckin(account, { beforeSubmit: async () => {} });
    await vi.runAllTimersAsync();
    expect(await task).toMatchObject({ uncertain: true, retryable: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledTimes(1);
  });

  it("点击脚本没有返回时按不确定处理，不再次点击", async () => {
    executeScript.mockImplementation(async ({ func, args }) => {
      if (func.name === "extractSessionFromPage") return [{ result: { userId: "12" } }];
      return args[0] ? new Promise(() => {}) : [{ result: "found" }];
    });
    const task = assistTurnstileCheckin(account, { beforeSubmit: async () => {} });
    await vi.runAllTimersAsync();
    expect(await task).toMatchObject({ uncertain: true, retryable: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect(checkIn).not.toHaveBeenCalled();
  });

  it("没有按钮的候选可以继续，但只对最终命中的页面保存提交日志", async () => {
    let searches = 0;
    const beforeSubmit = vi.fn(async () => {});
    executeScript.mockImplementation(async ({ func, args }) => {
      if (func.name === "extractSessionFromPage") return [{ result: { userId: "12" } }];
      if (!args[0]) return [{ result: ++searches === 1 ? "not_found" : "found" }];
      return [{ result: "clicked" }];
    });
    const task = assistTurnstileCheckin(account, { beforeSubmit });
    await vi.runAllTimersAsync();
    expect(await task).toMatchObject({ status: "success" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
  });

  it("提交日志保存失败时不能点击或继续下一候选", async () => {
    const task = assistTurnstileCheckin(account, { beforeSubmit: async () => { throw new Error("storage failed"); } });
    await vi.runAllTimersAsync();
    expect(await task).toMatchObject({ reason: "storage", retryable: false });
    expect(executeScript.mock.calls.some(([input]) => input.func.name === "checkinTrigger" && input.args[0])).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("页面实际登录了另一账号时不点击", async () => {
    executeScript.mockImplementation(async ({ func }) => [{
      result: func.name === "extractSessionFromPage" ? { userId: "99" } : "found",
    }]);
    const beforeSubmit = vi.fn();
    const task = assistTurnstileCheckin(account, { beforeSubmit });
    await vi.runAllTimersAsync();
    expect(await task).toBeNull();
    expect(beforeSubmit).not.toHaveBeenCalled();
    expect(checkIn).not.toHaveBeenCalled();
  });

  it("跨域自定义页面只供用户手动打开，自动流程不点击", async () => {
    expect(await assistTurnstileCheckin({ ...account, checkinPageUrl: "https://other.example.com/checkin" })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("只读核对模式不打开辅助窗口", async () => {
    expect(await assistTurnstileCheckin(account, { reconcileOnly: true })).toMatchObject({ uncertain: true });
    expect(create).not.toHaveBeenCalled();
  });
});
