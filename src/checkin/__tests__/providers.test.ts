import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { ApiError } from "@/api/transport";
import { accountsItem } from "@/storage/items";
import type { Account } from "@/types";
import { newApiProvider } from "../providers/newApi";
import { veloeraProvider } from "../providers/veloera";
import { voapiV2Provider } from "../providers/voapiV2";

const { siteFetch } = vi.hoisted(() => ({ siteFetch: vi.fn() }));
vi.mock("@/api/transport", async (original) => ({
  ...await original<typeof import("@/api/transport")>(), siteFetch,
}));

const account: Account = {
  id: "a", name: "测试站", url: "https://api.example.com", siteType: "new-api",
  authType: "token", userId: "12", accessToken: "token", groupId: null, tagIds: [],
  disabled: false, checkinEnabled: true, createdAt: 1, updatedAt: 1,
};

const cases = [
  {
    type: "new-api" as const, provider: newApiProvider, statusPath: "/api/user/checkin?month=",
    status: (checked: boolean) => ({ success: true, data: { stats: { checked_in_today: checked } } }),
    success: { success: true, message: "签到成功" },
  },
  {
    type: "veloera" as const, provider: veloeraProvider, statusPath: "/api/user/check_in_status",
    status: (checked: boolean) => ({ success: true, data: { can_check_in: !checked } }),
    success: { success: true, message: "签到成功" },
  },
  {
    type: "voapi-v2" as const, provider: voapiV2Provider, statusPath: "/api/check_in/stats",
    status: (checked: boolean) => ({ code: 0, data: { todaySigned: checked } }),
    success: { code: 0, msg: "ok" },
  },
];

beforeEach(async () => {
  fakeBrowser.reset();
  siteFetch.mockReset();
  await accountsItem.setValue([account]);
});

describe.each(cases)("$type 先查后签", ({ type, provider, statusPath, status, success }) => {
  const target = { ...account, siteType: type };

  it("服务端确认已签后不发送 POST，也不调用提交前日志", async () => {
    siteFetch.mockResolvedValueOnce(status(true));
    const beforeSubmit = vi.fn();
    expect(await provider.checkIn(target, { beforeSubmit })).toMatchObject({ status: "already_checked", capability: "supported" });
    expect(siteFetch).toHaveBeenCalledTimes(1);
    expect(siteFetch.mock.calls[0][1]).toContain(statusPath);
    expect(beforeSubmit).not.toHaveBeenCalled();
  });

  it("确认未签并保存提交日志后才发写请求", async () => {
    const events: string[] = [];
    siteFetch.mockImplementation(async (_account, _url, options) => {
      events.push(options?.method === "POST" ? "post" : "read");
      return options?.method === "POST" ? success : status(events.includes("post"));
    });
    expect(await provider.checkIn(target, { beforeSubmit: async () => { events.push("saved"); } }))
      .toMatchObject({ status: "success" });
    expect(events.slice(0, 3)).toEqual(["read", "saved", "post"]);
    expect(events.filter((v) => v === "post")).toHaveLength(1);
  });

  it.each([{}, null, { success: true, code: 0, data: {} }])("状态响应无效时阻止提交：%j", async (body) => {
    siteFetch.mockResolvedValueOnce(body);
    expect(await provider.checkIn(target)).toMatchObject({ reason: "invalid_response", retryable: false });
    expect(siteFetch).toHaveBeenCalledTimes(1);
  });

  it("只读阶段 500 可重试，不记录能力失效", async () => {
    siteFetch.mockRejectedValueOnce(new ApiError(500, "服务器暂不可用", "NON_JSON_RESPONSE"));
    const result = await provider.checkIn(target);
    expect(result).toMatchObject({ status: "failed", reason: "server", retryable: true });
    expect(result.capability).toBeUndefined();
    expect(siteFetch).toHaveBeenCalledTimes(1);
  });

  it("查询身份失败不会提交或自动重试", async () => {
    siteFetch.mockRejectedValueOnce(new ApiError(401, "请重新登录"));
    expect(await provider.checkIn(target)).toMatchObject({ reason: "authentication", retryable: false });
    expect(siteFetch).toHaveBeenCalledTimes(1);
  });

  it("无法保存提交前记录时不发送 POST", async () => {
    siteFetch.mockResolvedValueOnce(status(false));
    expect(await provider.checkIn(target, { beforeSubmit: async () => { throw new Error("磁盘不可用"); } }))
      .toMatchObject({ reason: "storage", retryable: false });
    expect(siteFetch).toHaveBeenCalledTimes(1);
  });

  it("POST 超时后只查一次状态，已签则确认成功", async () => {
    siteFetch.mockResolvedValueOnce(status(false))
      .mockRejectedValueOnce(new ApiError(0, "超时", "REQUEST_TIMEOUT"))
      .mockResolvedValueOnce(status(true));
    expect(await provider.checkIn(target)).toMatchObject({ status: "success", capability: "supported" });
    expect(siteFetch).toHaveBeenCalledTimes(3);
    expect(siteFetch.mock.calls.filter((call) => call[2]?.method === "POST")).toHaveLength(1);
  });

  it("提交结果不明且只读仍未签，保留不确定状态，不重发", async () => {
    siteFetch.mockResolvedValueOnce(status(false))
      .mockRejectedValueOnce(new ApiError(500, "server error"))
      .mockResolvedValueOnce(status(false));
    expect(await provider.checkIn(target)).toMatchObject({ reason: "uncertain", uncertain: true, retryable: false });
    expect(siteFetch.mock.calls.filter((call) => call[2]?.method === "POST")).toHaveLength(1);
  });

  it("重启后的核对模式只读，即使状态明确未签也不提交", async () => {
    siteFetch.mockResolvedValueOnce(status(false));
    const beforeSubmit = vi.fn();
    expect(await provider.checkIn(target, { reconcileOnly: true, beforeSubmit })).toMatchObject({ uncertain: true, retryable: false });
    expect(siteFetch).toHaveBeenCalledTimes(1);
    expect(beforeSubmit).not.toHaveBeenCalled();
  });

  it("核对时的限流保留等待时刻和不确定标记", async () => {
    const until = Date.now() + 120_000;
    siteFetch.mockResolvedValueOnce(status(false))
      .mockRejectedValueOnce(new ApiError(0, "网络断开"))
      .mockRejectedValueOnce(new ApiError(429, "slow down", undefined, until));
    expect(await provider.checkIn(target)).toMatchObject({ uncertain: true, retryable: false, retryAt: until });
  });
});

describe("能力证据与协议特例", () => {
  it("仅签到状态接口自身的 JSON 404 可记为不支持", async () => {
    siteFetch.mockImplementationOnce(async (_account, endpoint) => {
      throw Object.assign(new ApiError(404, "not found"), { requestUrl: account.url + endpoint });
    });
    expect(await newApiProvider.checkIn(account)).toMatchObject({ reason: "unsupported", capability: "unsupported", retryable: false });
  });

  it("会话刷新接口的 404 不污染签到能力", async () => {
    siteFetch.mockRejectedValueOnce(Object.assign(new ApiError(404, "not found"), {
      requestUrl: account.url + "/api/user/auth/refresh",
    }));
    const result = await newApiProvider.checkIn(account);
    expect(result.capability).toBeUndefined();
    expect(result.reason).toBe("invalid_response");
  });

  it("HTML 404 不能作为不支持签到的证据", async () => {
    siteFetch.mockImplementationOnce(async (_account, endpoint) => {
      throw Object.assign(new ApiError(404, "html", "NON_JSON_RESPONSE"), { requestUrl: account.url + endpoint });
    });
    expect(await newApiProvider.checkIn(account)).toMatchObject({ reason: "invalid_response", retryable: false });
  });

  it("明确关闭签到时记录能力，但不尝试提交", async () => {
    siteFetch.mockResolvedValueOnce({ success: true, data: { enabled: false } });
    expect(await newApiProvider.checkIn(account)).toMatchObject({ reason: "disabled", capability: "disabled" });
    expect(siteFetch).toHaveBeenCalledTimes(1);
  });

  it("提交 429 是明确拒绝，保留 Retry-After 供后续调度", async () => {
    const until = Date.now() + 90_000;
    siteFetch.mockResolvedValueOnce(cases[0].status(false))
      .mockRejectedValueOnce(new ApiError(429, "slow down", undefined, until));
    expect(await newApiProvider.checkIn(account)).toMatchObject({ reason: "rate_limited", retryable: true, retryAt: until });
    expect(siteFetch).toHaveBeenCalledTimes(2);
  });

  it("无效提交响应同样只读复核，不报成功", async () => {
    siteFetch.mockResolvedValueOnce(cases[0].status(false)).mockResolvedValueOnce(null).mockResolvedValueOnce(cases[0].status(false));
    expect(await newApiProvider.checkIn(account)).toMatchObject({ uncertain: true, retryable: false });
  });

  it("提交前的会话续期临时故障可重试，无须假定签到已提交", async () => {
    siteFetch.mockResolvedValueOnce(cases[0].status(false)).mockRejectedValueOnce(Object.assign(
      new ApiError(500, "refresh unavailable"),
      { requestUrl: account.url + "/api/user/auth/refresh", beforeRequest: true },
    ));
    expect(await newApiProvider.checkIn(account)).toMatchObject({ reason: "server", retryable: true });
    expect(siteFetch).toHaveBeenCalledTimes(2);
  });

  it("响应发生重定向本身不能证明未提交，仍需只读复核", async () => {
    siteFetch.mockResolvedValueOnce(cases[0].status(false))
      .mockRejectedValueOnce(Object.assign(new ApiError(500, "error"), { requestUrl: account.url + "/error" }))
      .mockResolvedValueOnce(cases[0].status(false));
    expect(await newApiProvider.checkIn(account)).toMatchObject({ uncertain: true, retryable: false });
    expect(siteFetch).toHaveBeenCalledTimes(3);
  });

  it("VoAPI 的 code 0 仍须 stats 复核，复核失败不冒充成功", async () => {
    const target = { ...account, siteType: "voapi-v2" as const };
    siteFetch.mockResolvedValueOnce(cases[2].status(false))
      .mockResolvedValueOnce({ code: 0, msg: "ok" }).mockRejectedValueOnce(new ApiError(500, "error"));
    expect(await voapiV2Provider.checkIn(target)).toMatchObject({ uncertain: true });
    expect(siteFetch.mock.calls.every((call) => call[2]?.rawToken === true)).toBe(true);
  });

  it("过期 JWT 标记只作用于原凭据，不覆盖用户已更新的 Token", async () => {
    const target = { ...account, siteType: "voapi-v2" as const };
    await accountsItem.setValue([{ ...target, accessToken: "new-token", tokenState: "ok" }]);
    siteFetch.mockResolvedValueOnce({ code: 2, msg: "auth expire" });
    expect(await voapiV2Provider.checkIn(target)).toMatchObject({ reason: "authentication", retryable: false });
    expect((await accountsItem.getValue())[0]).toMatchObject({ accessToken: "new-token", tokenState: "ok" });
  });
});
