import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { saveAccount } from "@/storage/accounts";
import { saveTag } from "@/storage/groupsTags";
import { accountsItem, tagsItem } from "@/storage/items";
import { executeAllApiHubImport, parseAllApiHubBackup } from "../fromAllApiHub";

function backupWith(accounts: unknown[], tagsById: Record<string, unknown> = {}) {
  return {
    version: "2.0",
    timestamp: 1,
    accounts: { accounts, bookmarks: [], pinnedAccountIds: [], orderedAccountIds: [], last_updated: 1 },
    tagStore: { version: 1, tagsById },
  };
}

const AAH_ACCOUNT = {
  site_name: "测试站",
  site_url: "https://api.example.com/console/",
  site_type: "new-api",
  account_info: { id: 42, access_token: "tok", username: "chang" },
  authType: "access_token",
  checkIn: { enableDetection: true, autoCheckInEnabled: true },
  notes: "备注",
  disabled: false,
  tagIds: ["t1"],
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe("parseAllApiHubBackup", () => {
  it("解析 V2 全量：字段映射、URL 规范化、userId 字符串化", () => {
    const preview = parseAllApiHubBackup(
      backupWith([AAH_ACCOUNT], { t1: { id: "t1", name: "主力", createdAt: 1 } }),
    );
    expect(preview.importable).toHaveLength(1);
    const a = preview.importable[0];
    expect(a.url).toBe("https://api.example.com");
    expect(a.userId).toBe("42");
    expect(a.siteType).toBe("new-api");
    expect(a.authType).toBe("token");
    expect(a.tagIds).toEqual(["t1"]);
    expect(preview.tags).toEqual([{ id: "t1", name: "主力", createdAt: 1 }]);
  });

  it("大写 Veloera 映射为 veloera；不支持的类型进 skipped", () => {
    const preview = parseAllApiHubBackup(
      backupWith([
        { ...AAH_ACCOUNT, site_type: "Veloera" },
        { ...AAH_ACCOUNT, site_name: "one 站", site_type: "one-api" },
      ]),
    );
    expect(preview.importable).toHaveLength(1);
    expect(preview.importable[0].siteType).toBe("veloera");
    expect(preview.skipped).toEqual([
      { name: "one 站", reason: "不支持的站点类型：one-api" },
    ]);
  });

  it("cookie 认证与 sessionCookie 保留", () => {
    const preview = parseAllApiHubBackup(
      backupWith([
        {
          ...AAH_ACCOUNT,
          site_type: "anyrouter",
          authType: "cookie",
          cookieAuth: { sessionCookie: "session=abc" },
        },
      ]),
    );
    expect(preview.importable[0].authType).toBe("cookie");
    expect(preview.importable[0].sessionCookie).toBe("session=abc");
  });

  it("非备份 JSON 抛可读错误", () => {
    expect(() => parseAllApiHubBackup({ foo: 1 })).toThrow(/无法识别的备份格式/);
  });
});

describe("executeAllApiHubImport", () => {
  it("导入账号与标签；老格式 tags 按名 findOrCreate", async () => {
    await saveTag({ name: "囤货" });
    const preview = parseAllApiHubBackup(
      backupWith(
        [{ ...AAH_ACCOUNT, tagIds: undefined, tags: ["囤货", "新标签"] }],
        {},
      ),
    );
    const report = await executeAllApiHubImport(preview, { overwriteExisting: false });

    expect(report.imported).toBe(1);
    const tags = await tagsItem.getValue();
    expect(tags.map((t) => t.name).sort()).toEqual(["囤货", "新标签"]);
    const [account] = await accountsItem.getValue();
    expect(account.tagIds).toHaveLength(2);
  });

  it("(url, userId) 判重：默认跳过，overwrite 时更新且保留原 id 与分组", async () => {
    const existing = await saveAccount({
      name: "旧名",
      url: "https://api.example.com",
      siteType: "new-api",
      authType: "token",
      userId: "42",
      accessToken: "old",
      groupId: "g1",
      tagIds: [],
      disabled: false,
      checkinEnabled: true,
    });

    const preview = parseAllApiHubBackup(backupWith([AAH_ACCOUNT]));

    const skip = await executeAllApiHubImport(preview, { overwriteExisting: false });
    expect(skip).toMatchObject({ imported: 0, skippedExisting: 1 });

    const over = await executeAllApiHubImport(preview, { overwriteExisting: true });
    expect(over.imported).toBe(1);
    const accounts = await accountsItem.getValue();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe(existing.id);
    expect(accounts[0].name).toBe("测试站");
    expect(accounts[0].groupId).toBe("g1");
  });
});
