import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
  accountsItem,
  checkinResultsItem,
  checkinSettingsItem,
  modelTestSettingsItem,
  uiSettingsItem,
  vaultMetaItem,
} from "@/storage/items";
import type { Account } from "@/types";
import { encryptSecret, setupVault } from "@/vault/vault";
import { exportOwnBackup, importOwnBackup } from "../ownBackup";

function account(partial: Partial<Account>): Account {
  return {
    id: "a1",
    name: "站点",
    url: "https://api.example.com",
    siteType: "new-api",
    authType: "token",
    userId: "1",
    groupId: null,
    tagIds: [],
    disabled: false,
    checkinEnabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("importOwnBackup · API 密钥", () => {
  it("merge 且主密码体系不同：密码凭证与 API 密钥剥离并计数，账号本身仍导入", async () => {
    await setupVault("local-master");
    const incoming = account({
      id: "x1",
      credential: { kind: "password", username: "u", passwordEnc: { iv: "AA", ciphertext: "BB" } },
      apiKeys: [
        { id: "k1", name: "", keyEnc: { iv: "AA", ciphertext: "BB" }, createdAt: 1 },
        { id: "k2", name: "备用", keyEnc: { iv: "AA", ciphertext: "CC" }, createdAt: 2 },
      ],
    });

    const report = await importOwnBackup(
      {
        app: "api-manager",
        version: 1,
        timestamp: 2,
        accounts: [incoming],
        groups: [],
        tags: [],
        checkinSettings: await checkinSettingsItem.getValue(),
        vault: { salt: "b3RoZXItc2FsdA==", verifier: { iv: "AA", ciphertext: "BB" }, createdAt: 1 },
      },
      "merge",
    );

    expect(report.droppedPasswords).toBe(1);
    expect(report.droppedApiKeys).toBe(2);
    const saved = (await accountsItem.getValue()).find((a) => a.id === "x1")!;
    expect(saved.credential).toBeUndefined();
    expect(saved.apiKeys).toBeUndefined();
  });

  it("merge 且同一主密码体系：API 密钥原样保留、不计丢弃", async () => {
    await setupVault("local-master");
    const vault = await vaultMetaItem.getValue();
    const incoming = account({
      id: "x2",
      apiKeys: [{ id: "k", name: "主用", keyEnc: await encryptSecret("sk-1"), createdAt: 1 }],
    });

    const report = await importOwnBackup(
      {
        app: "api-manager",
        version: 1,
        timestamp: 2,
        accounts: [incoming],
        groups: [],
        tags: [],
        checkinSettings: await checkinSettingsItem.getValue(),
        vault,
      },
      "merge",
    );

    expect(report.droppedPasswords).toBe(0);
    expect(report.droppedApiKeys).toBe(0);
    const saved = (await accountsItem.getValue()).find((a) => a.id === "x2")!;
    expect(saved.apiKeys).toHaveLength(1);
  });
});

describe("importOwnBackup · 新增备份字段", () => {
  it("导出含签到记录、模型测试配置与界面偏好，replace 导入整体恢复", async () => {
    await checkinResultsItem.setValue({ a1: { date: "2026-07-25", status: "success", at: 5 } });
    await uiSettingsItem.setValue({ zoom: 1.25 });
    const backup = await exportOwnBackup();
    expect(backup.checkinResults).toEqual({ a1: { date: "2026-07-25", status: "success", at: 5 } });
    expect(backup.uiSettings).toEqual({ zoom: 1.25 });
    expect(backup.modelTestSettings).toBeDefined();

    fakeBrowser.reset();
    await importOwnBackup(backup, "replace");
    expect(await checkinResultsItem.getValue()).toEqual({
      a1: { date: "2026-07-25", status: "success", at: 5 },
    });
    expect((await uiSettingsItem.getValue()).zoom).toBe(1.25);
  });

  it("merge：签到记录按 at 新者胜；模型测试配置与界面偏好不导入（本地胜）", async () => {
    await checkinResultsItem.setValue({
      a1: { date: "2026-07-25", status: "success", at: 10 },
      a2: { date: "2026-07-24", status: "failed", at: 3 },
    });
    await uiSettingsItem.setValue({ zoom: 1 });

    await importOwnBackup(
      {
        app: "api-manager",
        version: 1,
        timestamp: 2,
        accounts: [],
        groups: [],
        tags: [],
        checkinSettings: await checkinSettingsItem.getValue(),
        checkinResults: {
          a1: { date: "2026-07-24", status: "failed", at: 4 }, // 更旧，不覆盖
          a2: { date: "2026-07-25", status: "success", at: 8 }, // 更新，覆盖
          a3: { date: "2026-07-25", status: "success", at: 6 }, // 新账号，并入
        },
        uiSettings: { zoom: 1.4 },
      },
      "merge",
    );

    const results = await checkinResultsItem.getValue();
    expect(results.a1.at).toBe(10);
    expect(results.a2.at).toBe(8);
    expect(results.a3.at).toBe(6);
    expect((await uiSettingsItem.getValue()).zoom).toBe(1);
  });

  it("老版本备份（无新字段）导入不报错", async () => {
    await expect(
      importOwnBackup(
        {
          app: "api-manager",
          version: 1,
          timestamp: 2,
          accounts: [account({ id: "old-1" })],
          groups: [],
          tags: [],
          checkinSettings: await checkinSettingsItem.getValue(),
        },
        "replace",
      ),
    ).resolves.toMatchObject({ accounts: 1 });
  });

  it("merge 异库时备份里的模型测试记忆 key 密文不落地（设备偏好整体不导入）", async () => {
    await setupVault("local-master");
    const base = await modelTestSettingsItem.getValue();

    await importOwnBackup(
      {
        app: "api-manager",
        version: 1,
        timestamp: 2,
        accounts: [],
        groups: [],
        tags: [],
        checkinSettings: await checkinSettingsItem.getValue(),
        vault: { salt: "b3RoZXItc2FsdA==", verifier: { iv: "AA", ciphertext: "BB" }, createdAt: 1 },
        modelTestSettings: {
          ...base,
          manualKeysEnc: { "acc-x": { iv: "AA", ciphertext: "BB" } },
        },
      },
      "merge",
    );

    expect((await modelTestSettingsItem.getValue()).manualKeysEnc).toBeUndefined();
  });
});
