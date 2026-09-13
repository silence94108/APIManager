import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractSessionFromPage } from "../extractSession";

const local = new Map<string, string>();
const session = new Map<string, string>();
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  local.clear();
  session.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({ success: false }, 401));
  vi.stubGlobal("localStorage", { getItem: (key: string) => local.get(key) ?? null });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => session.get(key) ?? null });
  vi.stubGlobal("location", new URL("https://api.example.com/console/personal"));
  vi.stubGlobal("document", { querySelectorAll: () => [], cookie: "" });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("fetch", fetchMock);
});

describe("新版 New API 内存登录态", () => {
  const bundle = () => ({
    access_token: "modern-access-token",
    token_type: "Bearer",
    access_expires_at: Math.floor(Date.now() / 1000) + 900,
    user: { id: 78, username: "modern-user", role: 1 },
    session: { sid: "modern-session", current: true },
  });

  beforeEach(() => {
    vi.stubGlobal("document", { querySelectorAll: () => [], cookie: "theme=dark; new_api_has_session=1" });
  });

  it("Storage 没有 user 时，通过刷新接口识别账号并保留续期所需信息", async () => {
    const data = bundle();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data }));

    expect(await extractSessionFromPage()).toMatchObject({
      userId: "78",
      username: "modern-user",
      accessToken: "modern-access-token",
      sessionAuth: { sessionId: "modern-session", accessExpiresAt: data.access_expires_at },
      hasVoapiStore: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/user/auth/refresh", expect.objectContaining({
      method: "POST",
      credentials: "include",
    }));
  });

  it("使用页面相同的刷新锁，协调正在进行的站点续期", async () => {
    const requestLock = vi.fn(async (_name: string, _options: unknown, run: () => unknown) => run());
    vi.stubGlobal("navigator", { locks: { request: requestLock } });
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: bundle() }));

    expect((await extractSessionFromPage())?.userId).toBe("78");
    expect(requestLock).toHaveBeenCalledWith("new-api:auth-refresh", expect.objectContaining({
      mode: "exclusive",
      signal: expect.any(AbortSignal),
    }), expect.any(Function));
  });

  it("新版会话优先于升级前残留的旧账号缓存", async () => {
    local.set("user", JSON.stringify({ id: 99, access_token: "stale-token" }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: bundle() }));

    expect(await extractSessionFromPage()).toMatchObject({ userId: "78", accessToken: "modern-access-token" });
  });

  it("新版会话已失效时不回退使用旧缓存，也不调用旧版 Token 生成接口", async () => {
    local.set("user", JSON.stringify({ id: 99, access_token: "stale-token" }));

    expect(await extractSessionFromPage()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/user/auth/refresh", expect.anything());
  });

  it.each([
    ["过期令牌", { access_expires_at: 1 }],
    ["缺少会话", { session: undefined }],
    ["其他会话", { session: { sid: "other", current: false } }],
    ["错误 Token 类型", { token_type: "Basic" }],
    ["缺少账号", { user: undefined }],
  ])("拒绝%s", async (_name, patch) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { ...bundle(), ...patch } }));

    expect(await extractSessionFromPage()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("刷新竞争稍后重试，不把临时竞争当成未登录", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, code: "AUTH_REFRESH_RACE" }, 409));
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: bundle() }));

    const result = extractSessionFromPage();
    await vi.advanceTimersByTimeAsync(100);

    expect((await result)?.userId).toBe("78");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("extractSessionFromPage", () => {
  it("保留旧版 localStorage.user 的账号和现有 Token", async () => {
    local.set("user", JSON.stringify({ id: 12, username: "legacy", access_token: "old-token" }));

    expect(await extractSessionFromPage()).toEqual({
      userId: "12",
      username: "legacy",
      accessToken: "old-token",
      hasVoapiStore: false,
      faviconUrl: "https://api.example.com/favicon.ico",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("从 sessionStorage.user 识别账号，并用该账号 ID 补全 Token", async () => {
    session.set("user", JSON.stringify({ id: 23, username: "session-user" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: 23, username: "session-user" } }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: "session-token" }));

    expect(await extractSessionFromPage()).toMatchObject({
      userId: "23",
      username: "session-user",
      accessToken: "session-token",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/user/token",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "New-API-User": "23" }),
      }),
    );
  });

  it("没有浏览器缓存时，从同源登录接口取得账号后再获取 Token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: 34, username: "cookie-user" } }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: "cookie-token" }));

    expect(await extractSessionFromPage()).toMatchObject({
      userId: "34",
      username: "cookie-user",
      accessToken: "cookie-token",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/user/self",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/user/token",
      expect.objectContaining({
        headers: expect.objectContaining({ "New-API-User": "34" }),
      }),
    );
  });

  it("localStorage 数据损坏时仍能读取 sessionStorage", async () => {
    local.set("user", "{broken");
    session.set("user", JSON.stringify({ id: "45", access_token: "valid-token" }));

    expect(await extractSessionFromPage()).toMatchObject({
      userId: "45",
      accessToken: "valid-token",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("业务失败响应中的 data 不能作为账号，也不能触发 Token 生成", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, data: { id: 99, access_token: "invalid-token" } }),
    );

    expect(await extractSessionFromPage()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/user/self", expect.anything());
  });

  it("未登录时返回空结果，不调用生成 Token 的接口", async () => {
    expect(await extractSessionFromPage()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/user/self", expect.anything());
  });

  it("VoAPI 的 JWT 继续优先使用，不调用 New API 接口", async () => {
    local.set("user", JSON.stringify({ id: 56, username: "voapi" }));
    local.set("userStore", JSON.stringify({ auth: { token: "voapi-jwt" } }));

    expect(await extractSessionFromPage()).toMatchObject({
      userId: "56",
      accessToken: "voapi-jwt",
      hasVoapiStore: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("接口返回的当前账号不同于缓存时，不沿用旧账号的用户名", async () => {
    local.set("user", JSON.stringify({ id: 10, username: "old-user" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: 20, access_token: "new-token" } }),
    );

    const result = await extractSessionFromPage();
    expect(result).toMatchObject({ userId: "20", accessToken: "new-token" });
    expect(result?.username).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("当前标签页的账号优先，不混入 localStorage 中另一账号的 Token", async () => {
    local.set("user", JSON.stringify({ id: 10, access_token: "other-account-token" }));
    session.set("user", JSON.stringify({ id: 20, username: "current-user" }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 20 } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: "current-token" }));

    expect(await extractSessionFromPage()).toMatchObject({
      userId: "20",
      username: "current-user",
      accessToken: "current-token",
    });
  });

  it("Storage 访问被限制时仍可通过登录接口识别", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("Denied", "SecurityError"); },
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: 67, access_token: "api-token" } }),
    );

    expect(await extractSessionFromPage()).toMatchObject({ userId: "67", accessToken: "api-token" });
  });

  it.each([
    ["登录 HTML", () => new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } })],
    ["损坏 JSON", () => new Response("{broken", { headers: { "Content-Type": "application/json" } })],
  ])("%s 不会被当作账号数据", async (_label, response) => {
    fetchMock.mockResolvedValueOnce(response());

    expect(await extractSessionFromPage()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("接口无响应时会终止请求，不让识别一直等待", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_path, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const result = extractSessionFromPage();
    await vi.advanceTimersByTimeAsync(8000);

    expect(await result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
