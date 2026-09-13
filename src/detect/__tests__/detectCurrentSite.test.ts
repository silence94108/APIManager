import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectCurrentSite } from "../detectCurrentSite";

const { query, get, executeScript } = vi.hoisted(() => ({ query: vi.fn(), get: vi.fn(), executeScript: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: { tabs: { query, get }, scripting: { executeScript } } }));

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([{ id: 1, url: "https://api.example.com/console", title: "Test New API" }]);
  get.mockResolvedValue({ id: 1, url: "https://api.example.com/console" });
  executeScript.mockResolvedValue([{ result: { userId: "12", accessToken: "verified-token", hasVoapiStore: false } }]);
});
afterEach(() => vi.useRealTimers());

describe("识别结果的来源与期限", () => {
  it("向注入函数传递原站点和截止时间，再组装已核验的账号", async () => {
    expect(await detectCurrentSite()).toMatchObject({ ok: true, account: { url: "https://api.example.com", userId: "12" } });
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ args: ["https://api.example.com", expect.any(Number)] }));
  });

  it("返回结果前页面已跨域跳转时拒绝旧身份", async () => {
    get.mockResolvedValue({ id: 1, url: "https://other.example.com" });
    expect(await detectCurrentSite()).toMatchObject({ ok: false, reason: expect.stringContaining("已跳转") });
  });

  it("没有核验身份时给出失败结果，不能用缓存拼出账号", async () => {
    executeScript.mockResolvedValue([{ result: null }]);
    expect(await detectCurrentSite()).toMatchObject({ ok: false, reason: expect.stringContaining("未能确认") });
  });

  it.each(["script", "tab"])("%s 不返回时后台仍按时结束", async (step) => {
    vi.useFakeTimers();
    (step === "script" ? executeScript : get).mockImplementationOnce(() => new Promise(() => {}));
    const result = detectCurrentSite();
    await vi.advanceTimersByTimeAsync(9000);
    expect(await result).toMatchObject({ ok: false, reason: expect.stringContaining("超时") });
    expect(vi.getTimerCount()).toBe(0);
  });
});
