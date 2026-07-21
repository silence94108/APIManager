import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { saveAccount, type AccountDraft } from "@/storage/accounts";
import { accountsItem, vaultKeyItem, vaultMetaItem } from "@/storage/items";
import {
  changeVaultPassword,
  decryptSecret,
  encryptSecret,
  isVaultUnlocked,
  lockVault,
  resetVault,
  setupVault,
  unlockVault,
  VaultLockedError,
} from "../vault";

function draft(partial: Partial<AccountDraft> = {}): AccountDraft {
  return {
    name: "测试站",
    url: "https://api.example.com",
    siteType: "new-api",
    authType: "token",
    userId: "1",
    accessToken: "tok",
    groupId: null,
    tagIds: [],
    disabled: false,
    checkinEnabled: true,
    ...partial,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("vault 生命周期", () => {
  it("setup 后即解锁，加解密 roundtrip 成功", async () => {
    await setupVault("master-pw-1");
    expect(await isVaultUnlocked()).toBe(true);

    const blob = await encryptSecret("s3cret-密码!");
    expect(blob.ciphertext).not.toContain("s3cret");
    expect(await decryptSecret(blob)).toBe("s3cret-密码!");
  });

  it("锁定后加解密抛 VaultLockedError；错误密码解不了锁，正确密码可以", async () => {
    await setupVault("master-pw-1");
    const blob = await encryptSecret("s3cret");
    await lockVault();

    await expect(decryptSecret(blob)).rejects.toBeInstanceOf(VaultLockedError);
    await expect(encryptSecret("x")).rejects.toBeInstanceOf(VaultLockedError);

    expect(await unlockVault("wrong-pw")).toBe(false);
    expect(await isVaultUnlocked()).toBe(false);

    expect(await unlockVault("master-pw-1")).toBe(true);
    expect(await decryptSecret(blob)).toBe("s3cret");
  });

  it("重复 setup 抛错", async () => {
    await setupVault("a-master-pw");
    await expect(setupVault("another-pw")).rejects.toThrow("主密码已设置");
  });
});

describe("changeVaultPassword", () => {
  it("旧密码错误返回 false；正确则重加密已有凭证与 API 密钥，新旧密码换轨", async () => {
    await setupVault("old-master");
    const acc = await saveAccount(
      draft({
        credential: { kind: "password", username: "u", passwordEnc: await encryptSecret("site-pw") },
        apiKeys: [{ id: "k1", name: "主用", keyEnc: await encryptSecret("sk-aaa"), createdAt: 1 }],
      }),
    );

    expect(await changeVaultPassword("nope", "new-master-pw")).toBe(false);
    expect(await changeVaultPassword("old-master", "new-master-pw")).toBe(true);

    const updated = (await accountsItem.getValue()).find((a) => a.id === acc.id)!;
    const cred = updated.credential;
    if (cred?.kind !== "password") throw new Error("凭证类型不应改变");
    expect(await decryptSecret(cred.passwordEnc)).toBe("site-pw");
    expect(await decryptSecret(updated.apiKeys![0].keyEnc)).toBe("sk-aaa");

    await lockVault();
    expect(await unlockVault("old-master")).toBe(false);
    expect(await unlockVault("new-master-pw")).toBe(true);
  });

  it("解不开的 API 密钥脏密文被剔除，可解条目保留", async () => {
    await setupVault("old-master");
    const acc = await saveAccount(
      draft({
        apiKeys: [
          { id: "good", name: "好的", keyEnc: await encryptSecret("sk-good"), createdAt: 1 },
          { id: "dirty", name: "脏的", keyEnc: { iv: "AAAA", ciphertext: "BBBB" }, createdAt: 2 },
        ],
      }),
    );

    expect(await changeVaultPassword("old-master", "new-master-pw")).toBe(true);
    const updated = (await accountsItem.getValue()).find((a) => a.id === acc.id)!;
    expect(updated.apiKeys!.map((k) => k.id)).toEqual(["good"]);
    expect(await decryptSecret(updated.apiKeys![0].keyEnc)).toBe("sk-good");
  });
});

describe("resetVault", () => {
  it("清空 vault 并删除账密凭证与 API 密钥，OAuth 记录保留", async () => {
    await setupVault("a-master-pw");
    await saveAccount(
      draft({
        name: "pw站",
        credential: { kind: "password", username: "u", passwordEnc: await encryptSecret("x") },
        apiKeys: [
          { id: "k1", name: "", keyEnc: await encryptSecret("sk-1"), createdAt: 1 },
          { id: "k2", name: "备用", keyEnc: await encryptSecret("sk-2"), createdAt: 2 },
        ],
      }),
    );
    await saveAccount(
      draft({ name: "oauth站", credential: { kind: "oauth", provider: "linuxdo" } }),
    );

    expect(await resetVault()).toEqual({ passwords: 1, apiKeys: 2 });
    expect(await vaultMetaItem.getValue()).toBeNull();
    expect(await vaultKeyItem.getValue()).toBeNull();

    const all = await accountsItem.getValue();
    expect(all.find((a) => a.name === "pw站")!.credential).toBeUndefined();
    expect(all.find((a) => a.name === "pw站")!.apiKeys).toBeUndefined();
    expect(all.find((a) => a.name === "oauth站")!.credential?.kind).toBe("oauth");
  });
});
