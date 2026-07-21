import {
  accountsItem,
  checkinSettingsItem,
  groupsItem,
  tagsItem,
  vaultKeyItem,
  vaultMetaItem,
} from "@/storage/items";
import type { Account, CheckinSettings, Group, Tag, VaultMeta } from "@/types";

export interface OwnBackup {
  app: "api-manager";
  version: 1;
  timestamp: number;
  accounts: Account[];
  groups: Group[];
  tags: Tag[];
  checkinSettings: CheckinSettings;
  /** vault 元数据——密文凭证要在别处恢复必须带盐（配同一主密码解锁） */
  vault?: VaultMeta | null;
}

export async function exportOwnBackup(): Promise<OwnBackup> {
  const [accounts, groups, tags, checkinSettings, vault] = await Promise.all([
    accountsItem.getValue(),
    groupsItem.getValue(),
    tagsItem.getValue(),
    checkinSettingsItem.getValue(),
    vaultMetaItem.getValue(),
  ]);
  return {
    app: "api-manager",
    version: 1,
    timestamp: Date.now(),
    accounts,
    groups,
    tags,
    checkinSettings,
    vault,
  };
}

export interface OwnImportReport {
  accounts: number;
  groups: number;
  tags: number;
  /** 因主密码体系不同而丢弃的密码凭证数（账号本身仍导入） */
  droppedPasswords: number;
  /** 因主密码体系不同而丢弃的 API 密钥条数（账号本身仍导入） */
  droppedApiKeys: number;
}

/** 采纳备份的 vault 元数据；库换了则旧解锁密钥作废 */
async function adoptVault(incoming: VaultMeta | null): Promise<void> {
  const cur = await vaultMetaItem.getValue();
  if (cur?.salt === incoming?.salt) return;
  await vaultMetaItem.setValue(incoming);
  await vaultKeyItem.setValue(null);
}

/**
 * 导入自身备份。
 * replace：数据整体覆盖（含 vault）；merge：按 id 合并（账号以 updatedAt 新者胜，组/标签已存在跳过）。
 * merge 时若两边 vault 不同（主密码不同），备份里的密码密文本地解不开——丢弃这些密码凭证并计数上报。
 */
export async function importOwnBackup(
  json: unknown,
  mode: "replace" | "merge",
): Promise<OwnImportReport> {
  const backup = json as Partial<OwnBackup>;
  if (backup?.app !== "api-manager" || !Array.isArray(backup.accounts)) {
    throw new Error("不是 APIManager 的备份文件");
  }
  const accounts = backup.accounts;
  const groups = Array.isArray(backup.groups) ? backup.groups : [];
  const tags = Array.isArray(backup.tags) ? backup.tags : [];

  if (mode === "replace") {
    await Promise.all([
      accountsItem.setValue(accounts),
      groupsItem.setValue(groups),
      tagsItem.setValue(tags),
      ...(backup.checkinSettings ? [checkinSettingsItem.setValue(backup.checkinSettings)] : []),
    ]);
    if (backup.vault !== undefined) await adoptVault(backup.vault);
    return {
      accounts: accounts.length,
      groups: groups.length,
      tags: tags.length,
      droppedPasswords: 0,
      droppedApiKeys: 0,
    };
  }

  const [curAccounts, curGroups, curTags, curVault] = await Promise.all([
    accountsItem.getValue(),
    groupsItem.getValue(),
    tagsItem.getValue(),
    vaultMetaItem.getValue(),
  ]);

  const incomingVault = backup.vault ?? null;
  let droppedPasswords = 0;
  let droppedApiKeys = 0;
  let mergeAccounts = accounts;
  if (!curVault && incomingVault) {
    await adoptVault(incomingVault);
  } else if (curVault && incomingVault && curVault.salt !== incomingVault.salt) {
    mergeAccounts = accounts.map((a) => {
      const hasPassword = a.credential?.kind === "password";
      const keyCount = a.apiKeys?.length ?? 0;
      if (!hasPassword && !keyCount) return a;
      if (hasPassword) droppedPasswords++;
      droppedApiKeys += keyCount;
      return { ...a, credential: hasPassword ? undefined : a.credential, apiKeys: undefined };
    });
  }

  const accountById = new Map(curAccounts.map((a) => [a.id, a]));
  let accountsChanged = 0;
  for (const incoming of mergeAccounts) {
    const cur = accountById.get(incoming.id);
    if (!cur || incoming.updatedAt > cur.updatedAt) {
      accountById.set(incoming.id, incoming);
      accountsChanged++;
    }
  }

  const groupIds = new Set(curGroups.map((g) => g.id));
  const newGroups = groups.filter((g) => !groupIds.has(g.id));
  const tagIds = new Set(curTags.map((t) => t.id));
  const newTags = tags.filter((t) => !tagIds.has(t.id));

  await Promise.all([
    accountsItem.setValue([...accountById.values()]),
    newGroups.length ? groupsItem.setValue([...curGroups, ...newGroups]) : Promise.resolve(),
    newTags.length ? tagsItem.setValue([...curTags, ...newTags]) : Promise.resolve(),
  ]);

  return {
    accounts: accountsChanged,
    groups: newGroups.length,
    tags: newTags.length,
    droppedPasswords,
    droppedApiKeys,
  };
}
