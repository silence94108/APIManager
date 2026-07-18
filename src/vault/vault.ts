import { accountsItem, vaultKeyItem, vaultMetaItem } from "@/storage/items";
import type { EncryptedBlob } from "@/types";
import {
  decryptString,
  deriveAesKey,
  encryptString,
  exportKeyB64,
  fromB64,
  importKeyB64,
  randomBytes,
  toB64,
} from "./crypto";

const VERIFIER_PLAINTEXT = "api-manager-vault-v1";

export class VaultLockedError extends Error {
  constructor() {
    super("保险库已锁定，请先解锁");
    this.name = "VaultLockedError";
  }
}

export async function isVaultSetup(): Promise<boolean> {
  return (await vaultMetaItem.getValue()) !== null;
}

export async function isVaultUnlocked(): Promise<boolean> {
  return (await vaultKeyItem.getValue()) !== null;
}

async function currentKey(): Promise<CryptoKey | null> {
  const b64 = await vaultKeyItem.getValue();
  return b64 ? importKeyB64(b64) : null;
}

/** 首次设置主密码并进入解锁态；已设置时抛错（改密走 changeVaultPassword） */
export async function setupVault(password: string): Promise<void> {
  if (await vaultMetaItem.getValue()) throw new Error("主密码已设置");
  const salt = randomBytes(16);
  const key = await deriveAesKey(password, salt);
  await vaultMetaItem.setValue({
    salt: toB64(salt),
    verifier: await encryptString(key, VERIFIER_PLAINTEXT),
    createdAt: Date.now(),
  });
  await vaultKeyItem.setValue(await exportKeyB64(key));
}

export async function unlockVault(password: string): Promise<boolean> {
  const meta = await vaultMetaItem.getValue();
  if (!meta) return false;
  const key = await deriveAesKey(password, fromB64(meta.salt));
  try {
    await decryptString(key, meta.verifier);
  } catch {
    return false;
  }
  await vaultKeyItem.setValue(await exportKeyB64(key));
  return true;
}

export async function lockVault(): Promise<void> {
  await vaultKeyItem.setValue(null);
}

export async function encryptSecret(plain: string): Promise<EncryptedBlob> {
  const key = await currentKey();
  if (!key) throw new VaultLockedError();
  return encryptString(key, plain);
}

export async function decryptSecret(blob: EncryptedBlob): Promise<string> {
  const key = await currentKey();
  if (!key) throw new VaultLockedError();
  return decryptString(key, blob);
}

/** 校验旧密码 → 新盐派生新钥 → 全部账密凭证重加密；解不开的脏密文（异库合并残留）直接丢弃 */
export async function changeVaultPassword(
  oldPassword: string,
  newPassword: string,
): Promise<boolean> {
  const meta = await vaultMetaItem.getValue();
  if (!meta) return false;
  const oldKey = await deriveAesKey(oldPassword, fromB64(meta.salt));
  try {
    await decryptString(oldKey, meta.verifier);
  } catch {
    return false;
  }

  const salt = randomBytes(16);
  const newKey = await deriveAesKey(newPassword, salt);
  const accounts = await accountsItem.getValue();
  const reEncrypted = await Promise.all(
    accounts.map(async (a) => {
      if (a.credential?.kind !== "password") return a;
      try {
        const plain = await decryptString(oldKey, a.credential.passwordEnc);
        return {
          ...a,
          credential: { ...a.credential, passwordEnc: await encryptString(newKey, plain) },
        };
      } catch {
        return { ...a, credential: undefined };
      }
    }),
  );
  await accountsItem.setValue(reEncrypted);
  await vaultMetaItem.setValue({
    salt: toB64(salt),
    verifier: await encryptString(newKey, VERIFIER_PLAINTEXT),
    createdAt: meta.createdAt,
  });
  await vaultKeyItem.setValue(await exportKeyB64(newKey));
  return true;
}

/** 忘记主密码的兜底：清空 vault 并删除所有账密凭证（OAuth 记录保留），返回删除数 */
export async function resetVault(): Promise<number> {
  const accounts = await accountsItem.getValue();
  const stripped = accounts.filter((a) => a.credential?.kind === "password").length;
  if (stripped) {
    await accountsItem.setValue(
      accounts.map((a) =>
        a.credential?.kind === "password" ? { ...a, credential: undefined } : a,
      ),
    );
  }
  await vaultMetaItem.setValue(null);
  await vaultKeyItem.setValue(null);
  return stripped;
}
