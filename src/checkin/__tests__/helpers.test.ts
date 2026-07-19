import { describe, expect, it } from "vitest";
import { resolveCheckinPageUrl } from "../helpers";

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
