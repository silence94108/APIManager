import type { Group, Tag } from "@/types";
import { accountsItem, groupsItem, tagsItem } from "./items";

// ── 分组 ──────────────────────────────────────────────

export async function saveGroup(input: { id?: string; name: string }): Promise<Group> {
  const groups = await groupsItem.getValue();
  const existing = input.id ? groups.find((g) => g.id === input.id) : undefined;

  if (existing) {
    const updated = { ...existing, name: input.name };
    await groupsItem.setValue(groups.map((g) => (g.id === updated.id ? updated : g)));
    return updated;
  }

  const created: Group = {
    id: crypto.randomUUID(),
    name: input.name,
    sortOrder: groups.length,
    collapsed: false,
    createdAt: Date.now(),
  };
  await groupsItem.setValue([...groups, created]);
  return created;
}

export async function setGroupCollapsed(id: string, collapsed: boolean): Promise<void> {
  const groups = await groupsItem.getValue();
  await groupsItem.setValue(groups.map((g) => (g.id === id ? { ...g, collapsed } : g)));
}

export async function reorderGroups(orderedIds: string[]): Promise<void> {
  const groups = await groupsItem.getValue();
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  await groupsItem.setValue(
    groups.map((g) => ({ ...g, sortOrder: rank.get(g.id) ?? g.sortOrder })),
  );
}

/** 删除分组：组内账号 groupId 置 null（进"未分组"），不删账号 */
export async function deleteGroup(id: string): Promise<void> {
  const groups = await groupsItem.getValue();
  await groupsItem.setValue(groups.filter((g) => g.id !== id));

  const accounts = await accountsItem.getValue();
  if (accounts.some((a) => a.groupId === id)) {
    await accountsItem.setValue(
      accounts.map((a) => (a.groupId === id ? { ...a, groupId: null } : a)),
    );
  }
}

// ── 标签 ──────────────────────────────────────────────

export async function saveTag(input: { id?: string; name: string }): Promise<Tag> {
  const tags = await tagsItem.getValue();
  const existing = input.id ? tags.find((t) => t.id === input.id) : undefined;

  if (existing) {
    const updated = { ...existing, name: input.name };
    await tagsItem.setValue(tags.map((t) => (t.id === updated.id ? updated : t)));
    return updated;
  }

  const created: Tag = { id: crypto.randomUUID(), name: input.name, createdAt: Date.now() };
  await tagsItem.setValue([...tags, created]);
  return created;
}

/** 按名取或建（导入 all-api-hub 老格式 tags:string[] 时用） */
export async function findOrCreateTagByName(name: string): Promise<Tag> {
  const tags = await tagsItem.getValue();
  const found = tags.find((t) => t.name === name);
  if (found) return found;
  return saveTag({ name });
}

/** 删除标签：清掉所有账号 tagIds 里的引用 */
export async function deleteTag(id: string): Promise<void> {
  const tags = await tagsItem.getValue();
  await tagsItem.setValue(tags.filter((t) => t.id !== id));

  const accounts = await accountsItem.getValue();
  if (accounts.some((a) => a.tagIds.includes(id))) {
    await accountsItem.setValue(
      accounts.map((a) =>
        a.tagIds.includes(id) ? { ...a, tagIds: a.tagIds.filter((t) => t !== id) } : a,
      ),
    );
  }
}
