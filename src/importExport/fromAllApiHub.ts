import { accountsItem, tagsItem } from "@/storage/items";
import type { Account, SiteType, Tag } from "@/types";
import { normalizeOrigin } from "@/utils/url";

/** all-api-hub site_type → 本项目 siteType（精确匹配，注意原版 "Veloera" 大写 V） */
const SITE_TYPE_MAP: Record<string, SiteType> = {
  "new-api": "new-api",
  Veloera: "veloera",
  "voapi-v2": "voapi-v2",
  anyrouter: "anyrouter",
};

interface AahAccountShape {
  site_name?: string;
  site_url?: string;
  site_type?: string;
  account_info?: { id?: number | string; access_token?: string; username?: string };
  authType?: string;
  cookieAuth?: { sessionCookie?: string };
  checkIn?: { enableDetection?: boolean; autoCheckInEnabled?: boolean };
  notes?: string;
  disabled?: boolean;
  tagIds?: string[];
  tags?: string[];
}

export interface ParsedImportAccount {
  name: string;
  url: string;
  siteType: SiteType;
  authType: "token" | "cookie";
  userId: string;
  accessToken?: string;
  sessionCookie?: string;
  username?: string;
  notes?: string;
  disabled: boolean;
  checkinEnabled: boolean;
  tagIds: string[];
  /** 老格式按名标签，executeImport 时转 id */
  legacyTagNames: string[];
}

export interface ImportPreview {
  importable: ParsedImportAccount[];
  skipped: { name: string; reason: string }[];
  tags: Tag[];
}

/** 解析 all-api-hub 备份 JSON（V2 全量 / 仅账号变体），纯解析不写存储 */
export function parseAllApiHubBackup(json: unknown): ImportPreview {
  const root = json as {
    accounts?: { accounts?: unknown };
    tagStore?: { tagsById?: Record<string, { id?: string; name?: string; createdAt?: number }> };
  };
  const rawAccounts = root?.accounts?.accounts;
  if (!Array.isArray(rawAccounts)) {
    throw new Error("无法识别的备份格式：未找到 accounts.accounts 数组（请用 all-api-hub 的“导出”功能生成文件）");
  }

  const importable: ParsedImportAccount[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const raw of rawAccounts as AahAccountShape[]) {
    const name = raw.site_name || raw.site_url || "(未命名)";
    const siteType = SITE_TYPE_MAP[raw.site_type ?? ""];
    if (!siteType) {
      skipped.push({ name, reason: `不支持的站点类型：${raw.site_type ?? "未知"}` });
      continue;
    }
    let url: string;
    try {
      url = normalizeOrigin(raw.site_url ?? "");
    } catch {
      skipped.push({ name, reason: "站点 URL 无效" });
      continue;
    }

    importable.push({
      name: raw.site_name || url,
      url,
      siteType,
      authType: raw.authType === "cookie" ? "cookie" : "token",
      userId: raw.account_info?.id != null ? String(raw.account_info.id) : "",
      accessToken: raw.account_info?.access_token || undefined,
      sessionCookie: raw.cookieAuth?.sessionCookie || undefined,
      username: raw.account_info?.username || undefined,
      notes: raw.notes || undefined,
      disabled: raw.disabled === true,
      checkinEnabled:
        raw.checkIn?.enableDetection !== false && raw.checkIn?.autoCheckInEnabled !== false,
      tagIds: Array.isArray(raw.tagIds) ? raw.tagIds : [],
      legacyTagNames: Array.isArray(raw.tags) ? raw.tags : [],
    });
  }

  const tags: Tag[] = Object.values(root?.tagStore?.tagsById ?? {})
    .filter((t): t is { id: string; name: string; createdAt?: number } => Boolean(t?.id && t?.name))
    .map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt ?? Date.now() }));

  return { importable, skipped, tags };
}

export interface ImportReport {
  imported: number;
  skippedExisting: number;
  tagsImported: number;
}

/** 执行导入：全部在内存合并（标签 id 合并 + legacy 名建档、账号按 (url, userId) 判重），最后各一次批量写 */
export async function executeAllApiHubImport(
  preview: ImportPreview,
  options: { overwriteExisting: boolean },
): Promise<ImportReport> {
  const existingTags = await tagsItem.getValue();
  const tagById = new Map(existingTags.map((t) => [t.id, t]));
  const tagByName = new Map(existingTags.map((t) => [t.name, t]));
  const nextTags = [...existingTags];
  let tagsImported = 0;

  for (const tag of preview.tags) {
    if (tagById.has(tag.id)) continue;
    tagById.set(tag.id, tag);
    tagByName.set(tag.name, tag);
    nextTags.push(tag);
    tagsImported++;
  }

  const legacyTagId = (name: string): string => {
    const found = tagByName.get(name);
    if (found) return found.id;
    const created: Tag = { id: crypto.randomUUID(), name, createdAt: Date.now() };
    tagById.set(created.id, created);
    tagByName.set(name, created);
    nextTags.push(created);
    tagsImported++;
    return created.id;
  };

  const existingAccounts = await accountsItem.getValue();
  const keyOf = (url: string, userId: string) => `${url}::${userId}`;
  const byKey = new Map(existingAccounts.map((a) => [keyOf(a.url, a.userId), a]));
  const nextAccounts = [...existingAccounts];
  const indexById = new Map(nextAccounts.map((a, i) => [a.id, i] as const));

  let imported = 0;
  let skippedExisting = 0;
  const now = Date.now();

  for (const parsed of preview.importable) {
    const existing = byKey.get(keyOf(parsed.url, parsed.userId));
    if (existing && !options.overwriteExisting) {
      skippedExisting++;
      continue;
    }

    const tagIds = parsed.tagIds.filter((id) => tagById.has(id));
    for (const legacyName of parsed.legacyTagNames) {
      const id = legacyTagId(legacyName);
      if (!tagIds.includes(id)) tagIds.push(id);
    }

    const account: Account = {
      id: existing?.id ?? crypto.randomUUID(),
      name: parsed.name,
      url: parsed.url,
      siteType: parsed.siteType,
      authType: parsed.authType,
      userId: parsed.userId,
      accessToken: parsed.accessToken,
      sessionCookie: parsed.sessionCookie,
      username: parsed.username,
      notes: parsed.notes,
      disabled: parsed.disabled,
      checkinEnabled: parsed.checkinEnabled,
      groupId: existing?.groupId ?? null,
      tagIds,
      tokenState: existing?.tokenState,
      balance: existing?.balance,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      nextAccounts[indexById.get(existing.id)!] = account;
    } else {
      byKey.set(keyOf(account.url, account.userId), account);
      indexById.set(account.id, nextAccounts.length);
      nextAccounts.push(account);
    }
    imported++;
  }

  await Promise.all([
    tagsImported > 0 ? tagsItem.setValue(nextTags) : Promise.resolve(),
    imported > 0 ? accountsItem.setValue(nextAccounts) : Promise.resolve(),
  ]);

  return { imported, skippedExisting, tagsImported };
}
