import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/types";

const fetchMock = vi.fn<typeof fetch>();
let siteFetch: typeof import("../transport").siteFetch;
let account: Account;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authResponse() {
  return {
    success: true,
    data: {
      access_token: "fresh-access-token",
      token_type: "Bearer",
      access_expires_at: Math.floor(Date.now() / 1000) + 900,
      user: { id: 12, username: "test-user" },
      session: { sid: "test-session", current: true },
    },
  };
}

beforeEach(async () => {
  vi.resetModules();
  ({ siteFetch } = await import("../transport"));
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse({ success: true, data: { quota: 500000 } }));
  vi.stubGlobal("fetch", fetchMock);
  account = {
    id: "test-account",
    name: "测试站",
    url: "https://api.example.com",
    siteType: "new-api",
    authType: "token",
    userId: "12",
    accessToken: "original-token",
    sessionAuth: { sessionId: "test-session", accessExpiresAt: Math.floor(Date.now() / 1000) - 10 },
    groupId: null,
    tagIds: [],
    disabled: false,
    checkinEnabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("siteFetch 新版 New API 会话续期", () => {
  it("令牌仍有效时直接请求，不刷新会话", async () => {
    account.sessionAuth!.accessExpiresAt = Math.floor(Date.now() / 1000) + 900;

    await siteFetch(account, "/api/user/self");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(account.url + "/api/user/self", expect.objectContaining({
      credentials: "omit",
      headers: expect.objectContaining({ Authorization: "Bearer original-token", "New-API-User": "12" }),
    }));
  });

  it("令牌过期后，绑定原会话续期，再携带新令牌请求余额", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(authResponse()));

    expect(await siteFetch(account, "/api/user/self")).toMatchObject({ success: true });

    expect(fetchMock).toHaveBeenNthCalledWith(1, account.url + "/api/user/auth/refresh", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "X-Auth-Session": "test-session" }),
    }));
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
    expect(fetchMock).toHaveBeenNthCalledWith(2, account.url + "/api/user/self", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer fresh-access-token" }),
    }));
    expect(account.accessToken).toBe("original-token");
  });

  it("并行余额和用量请求共用一次续期，后续旧账号对象也复用新令牌", async () => {
    let resolveRefresh!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRefresh = resolve; }));

    const first = siteFetch(account, "/api/user/self");
    const second = siteFetch(account, "/api/log/self/stat");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveRefresh(jsonResponse(authResponse()));
    await Promise.all([first, second]);
    await siteFetch(account, "/api/user/models");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, options] of fetchMock.mock.calls.slice(1)) {
      expect(options?.headers).toHaveProperty("Authorization", "Bearer fresh-access-token");
    }
  });

  it("到期前被服务端拒绝时续期一次，并保留原 POST 的请求体", async () => {
    account.sessionAuth!.accessExpiresAt = Math.floor(Date.now() / 1000) + 900;
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false }, 401));
    fetchMock.mockResolvedValueOnce(jsonResponse(authResponse()));

    await siteFetch(account, "/api/user/checkin", { method: "POST", body: "{}" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(3, account.url + "/api/user/checkin", expect.objectContaining({
      method: "POST",
      body: "{}",
      headers: expect.objectContaining({ Authorization: "Bearer fresh-access-token" }),
    }));
  });

  it("续期后仍然 401 时停止，不循环重试业务请求", async () => {
    account.sessionAuth!.accessExpiresAt = Math.floor(Date.now() / 1000) + 900;
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false }, 401));
    fetchMock.mockResolvedValueOnce(jsonResponse(authResponse()));
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, message: "denied" }, 401));

    await expect(siteFetch(account, "/api/user/self")).rejects.toThrow("denied");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(["账号", "会话"])("刷新返回不同%s时拒绝继续请求", async (changed) => {
    const body = authResponse();
    if (changed === "账号") body.data.user.id = 99;
    else body.data.session.sid = "other-session";
    fetchMock.mockResolvedValueOnce(jsonResponse(body));

    await expect(siteFetch(account, "/api/user/self")).rejects.toThrow(/已变更/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, undefined],
    [409, "AUTH_SESSION_MISMATCH"],
  ])("刷新接口返回 %s / %s 时引导重新识别，不更换账号", async (status, code) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, code }, status));

    await expect(siteFetch(account, "/api/user/self")).rejects.toThrow(/重新识别/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("刷新竞争按短间隔重试后使用成功响应", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, code: "AUTH_REFRESH_RACE" }, 409));
    fetchMock.mockResolvedValueOnce(jsonResponse(authResponse()));

    const result = siteFetch(account, "/api/user/self");
    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("持续刷新竞争有次数上限", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => jsonResponse({ success: false, code: "AUTH_REFRESH_RACE" }, 409));

    const result = expect(siteFetch(account, "/api/user/self")).rejects.toMatchObject({ code: "AUTH_REFRESH_RACE" });
    await vi.advanceTimersByTimeAsync(850);
    await result;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("刷新响应中的过期令牌不能用于业务请求", async () => {
    const body = authResponse();
    body.data.access_expires_at = 1;
    fetchMock.mockResolvedValueOnce(jsonResponse(body));

    await expect(siteFetch(account, "/api/user/self")).rejects.toThrow(/有效登录会话/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("刷新超时会结束，并允许下一次请求重新尝试", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const result = expect(siteFetch(account, "/api/user/self")).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(8000);
    await result;
    expect(vi.getTimerCount()).toBe(0);

    fetchMock.mockResolvedValueOnce(jsonResponse(authResponse()));
    await expect(siteFetch(account, "/api/user/self")).resolves.toMatchObject({ success: true });
  });

  it("人机验证仍保留专用错误，不触发会话刷新", async () => {
    account.sessionAuth!.accessExpiresAt = Math.floor(Date.now() / 1000) + 900;
    fetchMock.mockResolvedValueOnce(new Response("challenge", {
      status: 401,
      headers: { "cf-mitigated": "challenge", "Content-Type": "text/html" },
    }));

    await expect(siteFetch(account, "/api/user/self")).rejects.toMatchObject({ name: "VerificationRequiredError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("siteFetch 旧版认证兼容", () => {
  it("无会话信息的长期 Token 不访问刷新接口，401 直接返回", async () => {
    account.sessionAuth = undefined;
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "legacy denied" }, 401));

    await expect(siteFetch(account, "/api/user/self")).rejects.toThrow("legacy denied");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("AnyRouter Cookie 与 VoAPI raw JWT 保持原请求方式", async () => {
    account.sessionAuth = undefined;
    account.authType = "cookie";
    account.accessToken = undefined;
    await siteFetch(account, "/api/user/sign_in", { method: "POST" });
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("include");
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");

    account.authType = "token";
    account.accessToken = "voapi-jwt";
    await siteFetch(account, "/api/user/info", { rawToken: true });
    expect(fetchMock.mock.calls[1][1]?.headers).toHaveProperty("Authorization", "voapi-jwt");
  });
});
