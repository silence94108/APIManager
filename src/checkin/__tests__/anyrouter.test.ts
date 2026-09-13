import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/types";
import { anyrouterProvider } from "../providers/anyrouter";
import { assistTurnstileCheckin } from "../turnstileAssist";

const { siteFetch, createWindow } = vi.hoisted(() => ({
  siteFetch: vi.fn(),
  createWindow: vi.fn(),
}));
vi.mock("@/api/transport", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/api/transport")>(),
  siteFetch,
}));
vi.mock("wxt/browser", () => ({
  browser: { windows: { create: createWindow } },
}));

const account: Account = {
  id: "any", name: "Any Router", url: "https://any.example.com", siteType: "anyrouter",
  authType: "cookie", userId: "12", groupId: null, tagIds: [], disabled: false,
  checkinEnabled: true, createdAt: 1, updatedAt: 1,
};

beforeEach(() => {
  siteFetch.mockReset();
  createWindow.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("AnyRouter 页面加载签到", () => {
  it("加载控制台页触发签到，再用原签到接口确认今日已签", async () => {
    siteFetch.mockResolvedValueOnce({ success: true, message: "" });

    expect(await anyrouterProvider.checkIn(account)).toMatchObject({ status: "already_checked" });
    expect(siteFetch).toHaveBeenCalledExactlyOnceWith(account, "/api/user/sign_in", {
      method: "POST", body: "{}", headers: { "X-Requested-With": "XMLHttpRequest" },
      pageUrl: account.url + "/console/topup", freshPage: true,
    });
  });

  it("用户填写的自动签到页面优先于默认控制台", async () => {
    siteFetch.mockResolvedValueOnce({ success: true, message: "签到成功" });

    await anyrouterProvider.checkIn({ ...account, checkinPageUrl: "/console" });

    expect(siteFetch).toHaveBeenCalledWith(expect.anything(), "/api/user/sign_in", expect.objectContaining({
      pageUrl: account.url + "/console", freshPage: true,
    }));
  });

  it.each([
    [{ success: false, message: "" }, "failed"],
    [{}, "failed"],
    [{ message: "unsuccessful" }, "failed"],
    [{ success: false, message: "今天已经签到" }, "already_checked"],
    [{ success: false, message: "请完成人机验证" }, "needs_verification"],
    [{ message: "" }, "already_checked"],
    [{ success: true, message: "签到成功" }, "success"],
  ])("正确区分确认响应 %j", async (response, status) => {
    siteFetch.mockResolvedValueOnce(response);

    expect(await anyrouterProvider.checkIn(account)).toMatchObject({ status });
  });

  it("页面签到尝试结束后不再另开窗口寻找签到按钮", async () => {
    expect(await assistTurnstileCheckin(account)).toBeNull();
    expect(createWindow).not.toHaveBeenCalled();
  });
});
