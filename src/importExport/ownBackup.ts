import { accountsItem, checkinSettingsItem, groupsItem, tagsItem } from "@/storage/items";
import type { Account, CheckinSettings, Group, Tag } from "@/types";

export interface OwnBackup {
  app: "api-manager";
  version: 1;
  timestamp: number;
  accounts: Account[];
  groups: Group[];
  tags: Tag[];
  checkinSettings: CheckinSettings;
}

export async function exportOwnBackup(): Promise<OwnBackup> {
  const [accounts, groups, tags, checkinSettings] = await Promise.all([
    accountsItem.getValue(),
    groupsItem.getValue(),
    tagsItem.getValue(),
    checkinSettingsItem.getValue(),
  ]);
  return { app: "api-manager", version: 1, timestamp: Date.now(), accounts, groups, tags, checkinSettings };
}

export interface OwnImportReport {
  accounts: number;
  groups: number;
  tags: number;
}

/**
 * 导入自身备份。
 * replace：四项整体覆盖；merge：按 id 合并（账号以 updatedAt 新者胜，组/标签已存在跳过）
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
    return { accounts: accounts.length, groups: groups.length, tags: tags.length };
  }

  const [curAccounts, curGroups, curTags] = await Promise.all([
    accountsItem.getValue(),
    groupsItem.getValue(),
    tagsItem.getValue(),
  ]);

  const accountById = new Map(curAccounts.map((a) => [a.id, a]));
  let accountsChanged = 0;
  for (const incoming of accounts) {
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

  return { accounts: accountsChanged, groups: newGroups.length, tags: newTags.length };
}
