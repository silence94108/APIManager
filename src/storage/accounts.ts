import type { Account } from "@/types";
import { accountsItem, checkinResultsItem, modelTestSettingsItem } from "./items";

export type AccountDraft = Omit<Account, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export async function getAccount(id: string): Promise<Account | undefined> {
  return (await accountsItem.getValue()).find((a) => a.id === id);
}

/** 有 id 且存在则整体更新，否则新建 */
export async function saveAccount(draft: AccountDraft): Promise<Account> {
  const accounts = await accountsItem.getValue();
  const now = Date.now();
  const existing = draft.id ? accounts.find((a) => a.id === draft.id) : undefined;

  if (existing) {
    const updated: Account = { ...existing, ...draft, id: existing.id, updatedAt: now };
    await accountsItem.setValue(accounts.map((a) => (a.id === updated.id ? updated : a)));
    return updated;
  }

  const created: Account = {
    ...draft,
    id: draft.id ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  await accountsItem.setValue([...accounts, created]);
  return created;
}

export async function patchAccount(
  id: string,
  patch: Partial<Omit<Account, "id" | "createdAt">>,
): Promise<Account | undefined> {
  const accounts = await accountsItem.getValue();
  const target = accounts.find((a) => a.id === id);
  if (!target) return undefined;
  const updated: Account = { ...target, ...patch, id, updatedAt: Date.now() };
  await accountsItem.setValue(accounts.map((a) => (a.id === id ? updated : a)));
  return updated;
}

/** 删除账号并连带清理孤儿数据：签到记录、模型测试记忆的手填 key */
export async function deleteAccount(id: string): Promise<void> {
  const accounts = await accountsItem.getValue();
  await accountsItem.setValue(accounts.filter((a) => a.id !== id));

  const results = await checkinResultsItem.getValue();
  if (id in results) {
    const { [id]: _dropped, ...rest } = results;
    await checkinResultsItem.setValue(rest);
  }

  const testSettings = await modelTestSettingsItem.getValue();
  if (id in testSettings.manualKeys) {
    const { [id]: _droppedKey, ...restKeys } = testSettings.manualKeys;
    await modelTestSettingsItem.setValue({ ...testSettings, manualKeys: restKeys });
  }
}
