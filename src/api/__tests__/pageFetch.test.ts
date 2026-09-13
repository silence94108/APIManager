import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFromSitePage, fetchInPage, type PageFetchRequest } from "../pageFetch";

const origin = "https://api.example.com";
const fetchMock = vi.fn<typeof fetch>();
const { query, create, get, remove, executeScript, onUpdated, onRemoved } = vi.hoisted(() => ({
  query: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  executeScript: vi.fn(),
  onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
}));
// WXT 会自动导入 browser 模块，替换全局 browser 无法拦截被测代码的调用。
vi.mock("wxt/browser", () => ({
  browser: {
    tabs: { query, create, get, remove, onUpdated, onRemoved },
    scripting: { executeScript },
  },
}));
let request: PageFetchRequest;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function injectionResult(body = { success: true }) {
  return [{ result: { response: {
    status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } } }];
}

beforeEach(() => {
  vi.resetAllMocks();
  fetchMock.mockImplementation(async () => jsonResponse({ success: true }));
  query.mockResolvedValue([]);
  create.mockResolvedValue({ id: 42 });
  get.mockImplementation(async (id: number) => ({ id, url: origin + "/", status: "complete" }));
  remove.mockResolvedValue(undefined);
  executeScript.mockResolvedValue(injectionResult());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", new URL(origin + "/console"));
  vi.stubGlobal("navigator", {});
  request = {
    url: origin + "/api/user/checkin",
    method: "POST",
    headers: { Authorization: "Bearer test-token", "New-API-User": "12" },
    body: "{}",
    credentials: "omit",
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("页面内同源请求", () => {
  it("使用原认证与请求体，禁止跨域和重定向", async () => {
    const result = await fetchInPage(request);

    expect(result).toMatchObject({ response: { status: 200, body: '{"success":true}' } });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(request.url, expect.objectContaining({
      method: "POST", body: "{}", headers: request.headers,
      credentials: "omit", mode: "same-origin", redirect: "error",
    }));
  });

  it("标签页已经导航到其他来源时不发送任何凭据", async () => {
    vi.stubGlobal("location", new URL("https://other.example.com"));

    expect(await fetchInPage(request)).toMatchObject({ error: { status: 0, message: expect.stringContaining("已跳转") } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Cookie 账号核对成功才发送签到，校验请求不能混入保存的 Bearer Token", async () => {
    request.credentials = "include";
    request.verifyUser = { id: "12", endpoint: "/api/user/self" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 12 } }));

    expect(await fetchInPage(request)).toMatchObject({ response: { body: '{"success":true}' } });
    expect(fetchMock).toHaveBeenNthCalledWith(1, origin + "/api/user/self", expect.objectContaining({
      method: "GET", credentials: "include", headers: { "New-API-User": "12" },
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, request.url, expect.objectContaining({ method: "POST", body: "{}" }));
  });

  it("浏览器 Cookie 切换了账号时不提交签到", async () => {
    request.credentials = "include";
    request.verifyUser = { id: "12", endpoint: "/api/user/self" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 99 } }));

    expect(await fetchInPage(request)).toMatchObject({ error: { status: 409, message: expect.stringContaining("不一致") } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { success: false, data: { id: 12 } },
    { success: true, data: {} },
    null,
  ])("未登录或身份响应无效时不提交签到：%j", async (response) => {
    request.credentials = "include";
    request.verifyUser = { id: "12", endpoint: "/api/user/self" };
    fetchMock.mockResolvedValueOnce(jsonResponse(response));

    expect(await fetchInPage(request)).toMatchObject({ error: { status: 401 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Cookie 校验返回 HTML 时保留原响应供后台分类，不执行签到", async () => {
    request.credentials = "include";
    request.verifyUser = { id: "12", endpoint: "/api/user/self" };
    fetchMock.mockResolvedValueOnce(new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }));

    expect(await fetchInPage(request)).toMatchObject({ response: { status: 200, body: "<html>login</html>" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Cookie 身份接口失败时序列化其真实地址", async () => {
    request.verifyUser = { id: "12", endpoint: "/api/user/self" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404));
    expect(await fetchInPage(request)).toMatchObject({
      response: { status: 404, url: origin + "/api/user/self" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("校验账号后发生跨域导航时不提交签到", async () => {
    request.credentials = "include";
    request.verifyUser = { id: "12", endpoint: "/api/user/self" };
    fetchMock.mockImplementationOnce(async () => {
      vi.stubGlobal("location", new URL("https://other.example.com"));
      return jsonResponse({ success: true, data: { id: 12 } });
    });

    expect(await fetchInPage(request)).toHaveProperty("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("拒绝跨域的身份查询地址", async () => {
    request.verifyUser = { id: "12", endpoint: "https://other.example.com/api/user/self" };

    expect(await fetchInPage(request)).toHaveProperty("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("余额本身就是身份查询时复用已验证响应", async () => {
    request.url = origin + "/api/user/self";
    request.method = "GET";
    request.body = undefined;
    request.credentials = "include";
    request.verifyUser = { id: "12", endpoint: "/api/user/self" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 12, quota: 500000 } }));

    expect(await fetchInPage(request)).toMatchObject({ response: { body: expect.stringContaining("500000") } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("新版 New API 续期在站点共享锁内执行并携带原会话 ID", async () => {
    const lock = vi.fn(async (_name: string, _options: unknown, run: () => unknown) => run());
    vi.stubGlobal("navigator", { locks: { request: lock } });
    request.url = origin + "/api/user/auth/refresh";
    request.headers = { "X-Auth-Session": "saved-session" };
    request.credentials = "include";
    request.refreshSession = true;
    request.body = undefined;

    await fetchInPage(request);

    expect(lock).toHaveBeenCalledWith("new-api:auth-refresh", expect.objectContaining({ mode: "exclusive", signal: expect.any(AbortSignal) }), expect.any(Function));
    expect(fetchMock).toHaveBeenCalledWith(request.url, expect.objectContaining({
      headers: { "X-Auth-Session": "saved-session" }, credentials: "include",
    }));
  });

  it.each([false, true])("页面请求有超时上限并清理计时器，续期=%s", async (refreshSession) => {
    vi.useFakeTimers();
    request.refreshSession = refreshSession;
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const result = fetchInPage(request);
    await vi.advanceTimersByTimeAsync(refreshSession ? 8000 : 15000);

    expect(await result).toMatchObject({ error: { status: 0, message: expect.stringContaining("超时") } });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("标签页复用与清理", () => {
  it("重建页面响应时保留身份接口来源", async () => {
    executeScript.mockResolvedValueOnce([{ result: { response: {
      status: 404, headers: { "content-type": "application/json" },
      body: '{"message":"not found"}', url: origin + "/api/user/self",
    } } }]);
    const response = await fetchFromSitePage(request);
    expect(response.url).toBe(origin + "/api/user/self");
  });
  it("复用现有同源页面，不跳转或关闭用户页面", async () => {
    query.mockResolvedValue([{ id: 7, url: origin + "/console" }]);

    expect(await (await fetchFromSitePage(request)).json()).toEqual({ success: true });

    expect(create).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7 }, args: [request, expect.any(Number)] }));
    expect(remove).not.toHaveBeenCalled();
  });

  it("没有可用页面时创建后台标签页，请求结束后关闭", async () => {
    query.mockResolvedValue([{ id: 7, url: "https://other.example.com" }]);

    await fetchFromSitePage(request);

    expect(create).toHaveBeenCalledExactlyOnceWith({ url: origin + "/", active: false });
    expect(remove).toHaveBeenCalledExactlyOnceWith(42);
    expect(onUpdated.removeListener).toHaveBeenCalledWith(onUpdated.addListener.mock.calls[0][0]);
    expect(onRemoved.removeListener).toHaveBeenCalledWith(onRemoved.addListener.mock.calls[0][0]);
  });

  it("页面执行失败也关闭扩展创建的标签页", async () => {
    executeScript.mockResolvedValueOnce([{ result: { error: { status: 409, message: "账号不一致" } } }]);

    await expect(fetchFromSitePage(request)).rejects.toMatchObject({ status: 409, message: "账号不一致" });
    expect(remove).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("注入前页面跳到别的站点时不传递凭据，不关闭用户原有标签页", async () => {
    query.mockResolvedValue([{ id: 7, url: origin + "/" }]);
    get.mockResolvedValueOnce({ id: 7, url: origin + "/", status: "complete" });
    get.mockResolvedValueOnce({ id: 7, url: "https://other.example.com", status: "complete" });

    await expect(fetchFromSitePage(request)).rejects.toThrow(/已跳转/);
    expect(executeScript).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("并发请求共用临时页，最后一个完成后才关闭", async () => {
    let resolveFirst!: (value: ReturnType<typeof injectionResult>) => void;
    let resolveSecond!: (value: ReturnType<typeof injectionResult>) => void;
    executeScript.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    executeScript.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const first = fetchFromSitePage(request);
    const second = fetchFromSitePage({ ...request, url: origin + "/api/user/models", method: "GET" });
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledTimes(2));
    resolveFirst(injectionResult());
    await first;

    expect(create).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();

    resolveSecond(injectionResult());
    await second;

    expect(remove).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("页面加载超时会清理监听器和临时页，下次仍可重试", async () => {
    vi.useFakeTimers();
    get.mockResolvedValue({ id: 42, url: origin + "/", status: "loading" });
    const result = expect(fetchFromSitePage(request)).rejects.toThrow(/打开该站并登录/);

    await vi.advanceTimersByTimeAsync(20000);
    await result;

    expect(remove).toHaveBeenCalledExactlyOnceWith(42);
    expect(onUpdated.removeListener).toHaveBeenCalled();
    expect(onRemoved.removeListener).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    get.mockResolvedValue({ id: 43, url: origin + "/", status: "complete" });
    create.mockResolvedValue({ id: 43 });
    await expect(fetchFromSitePage(request)).resolves.toBeInstanceOf(Response);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("加载 AnyRouter 签到页时另开后台页，不刷新用户原有标签页", async () => {
    query.mockResolvedValue([{ id: 7, url: origin + "/console" }]);
    request.pageUrl = origin + "/console/topup";
    request.freshPage = true;

    await fetchFromSitePage(request);

    expect(create).toHaveBeenCalledExactlyOnceWith({ url: request.pageUrl, active: false });
    expect(remove).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("拒绝不同源的自定义签到页，不打开或注入其他站点", async () => {
    request.pageUrl = "https://other.example.com/console";

    await expect(fetchFromSitePage(request)).rejects.toThrow(/不同源/);

    expect(create).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("页面脚本一直不返回时由后台超时结束，并允许下次重试", async () => {
    vi.useFakeTimers();
    executeScript.mockImplementationOnce(() => new Promise(() => {}));

    const result = expect(fetchFromSitePage(request)).rejects.toThrow(/响应超时/);
    await vi.advanceTimersByTimeAsync(30000);
    await result;

    expect(remove).toHaveBeenCalledWith(42);
    expect(vi.getTimerCount()).toBe(0);
    await expect(fetchFromSitePage(request)).resolves.toBeInstanceOf(Response);
  });

  it("创建页面本身卡住时也不会无限等待；迟到的页面关闭且不再发请求", async () => {
    vi.useFakeTimers();
    let resolveCreate!: (value: { id: number }) => void;
    create.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));

    const result = expect(fetchFromSitePage(request)).rejects.toThrow(/响应超时/);
    await vi.advanceTimersByTimeAsync(30000);
    await result;
    expect(executeScript).not.toHaveBeenCalled();

    resolveCreate({ id: 42 });
    await vi.advanceTimersByTimeAsync(0);

    expect(remove).toHaveBeenCalledWith(42);
    expect(executeScript).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("关闭临时页的浏览器 API 卡住时，已完成的业务请求仍能返回", async () => {
    remove.mockImplementationOnce(() => new Promise(() => {}));

    await expect(fetchFromSitePage(request)).resolves.toBeInstanceOf(Response);
    expect(remove).toHaveBeenCalledWith(42);
  });
});

describe("页面恢复后的期限检查", () => {
  it("过期的注入请求不能在页面恢复后补发签到", async () => {
    const result = await fetchInPage(request, Date.now() - 1);

    expect(result).toHaveProperty("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("新加载页面给前端留出自动签到时间，再校验和复核", async () => {
    vi.useFakeTimers();
    request.freshPage = true;
    request.credentials = "include";
    request.verifyUser = { id: "12", endpoint: "/api/user/self" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 12 } }));

    const result = fetchInPage(request);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);

    expect(await result).toHaveProperty("response");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
