import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { accountsItem, checkinSettingsItem, vaultMetaItem } from "@/storage/items";
import type { Account } from "@/types";
import { encryptSecret, setupVault } from "@/vault/vault";
import { importOwnBackup } from "../ownBackup";

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
