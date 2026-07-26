import { describe, expect, it } from "vitest";
import { defaultCheckinPath, resolveCheckinPageUrl, resolveCheckinPageUrls } from "../helpers";

const BASE = { url: "https://api.example.com" } as const;

describe("resolveCheckinPageUrl", () => {
  it("无自定义时用站点类型默认路径", () => {
    expect(resolveCheckinPageUrl({ ...BASE, siteType: "new-api" })).toBe(
      "https://api.example.com/console/personal",
    );
    expect(resolveCheckinPageUrl({ ...BASE, siteType: "anyrouter" })).toBe(
      "https://api.example.com/console/topup",
    );
    expect(resolveCheckinPageUrl({ ...BASE, siteType: "voapi-v2" })).toBe(
      "https://api.example.com/checkIn?_userMenuKey=checkIn",
    );
  });

  it("自定义 / 路径拼在站点域名上", () => {
    expect(
      resolveCheckinPageUrl({ ...BASE, siteType: "new-api", checkinPageUrl: "/my/checkin" }),
    ).toBe("https://api.example.com/my/checkin");
  });

  it("自定义完整 URL 原样使用（可跨域名）", () => {
    expect(
      resolveCheckinPageUrl({
        ...BASE,
        siteType: "new-api",
        checkinPageUrl: "https://panel.example.com/sign",
      }),
    ).toBe("https://panel.example.com/sign");
  });

  it("自定义为空白串视为未填", () => {
    expect(resolveCheckinPageUrl({ ...BASE, siteType: "new-api", checkinPageUrl: "  " })).toBe(
      "https://api.example.com/console/personal",
    );
  });

  it("无默认路径的类型兜底站点首页", () => {
    expect(resolveCheckinPageUrl({ ...BASE, siteType: "sub2api" })).toBe(BASE.url);
    expect(resolveCheckinPageUrl({ ...BASE, siteType: "other" })).toBe(BASE.url);
  });
});

describe("resolveCheckinPageUrls", () => {
  it("new-api 返回新老主题两个候选（默认主题在前）", () => {
    expect(resolveCheckinPageUrls({ ...BASE, siteType: "new-api" })).toEqual([
      "https://api.example.com/console/personal",
      "https://api.example.com/profile",
    ]);
  });

  it("单候选类型返回单元素数组", () => {
    expect(resolveCheckinPageUrls({ ...BASE, siteType: "anyrouter" })).toEqual([
      "https://api.example.com/console/topup",
    ]);
  });

  it("自定义链接时只返回这一条，不并入类型候选", () => {
    expect(
      resolveCheckinPageUrls({ ...BASE, siteType: "new-api", checkinPageUrl: "/my/checkin" }),
    ).toEqual(["https://api.example.com/my/checkin"]);
  });

  it("无候选的类型返回空数组（不兜底首页，供 turnstileAssist 依此放弃）", () => {
    expect(resolveCheckinPageUrls({ ...BASE, siteType: "sub2api" })).toEqual([]);
    expect(resolveCheckinPageUrls({ ...BASE, siteType: "other" })).toEqual([]);
  });
});

describe("defaultCheckinPath", () => {
  it("多候选类型取首候选", () => {
    expect(defaultCheckinPath("new-api")).toBe("/console/personal");
  });

  it("单候选类型返回该路径", () => {
    expect(defaultCheckinPath("anyrouter")).toBe("/console/topup");
    expect(defaultCheckinPath("voapi-v2")).toBe("/checkIn?_userMenuKey=checkIn");
  });

  it("无默认路径的类型返回 undefined", () => {
    expect(defaultCheckinPath("sub2api")).toBeUndefined();
  });
});
