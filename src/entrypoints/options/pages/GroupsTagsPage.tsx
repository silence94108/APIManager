import { useState, type ReactNode } from "react";
import {
  deleteGroup,
  deleteTag,
  reorderGroups,
  saveGroup,
  saveTag,
} from "@/storage/groupsTags";
import { accountsItem, groupsItem, tagsItem } from "@/storage/items";
import { Button, Dialog, EmptyState, Input, toast } from "@/ui/components";
import { useStorageItem } from "@/ui/hooks";

export default function GroupsTagsPage() {
  const groups = useStorageItem(groupsItem);
  const tags = useStorageItem(tagsItem);
  const accounts = useStorageItem(accountsItem);

  if (!groups || !tags || !accounts) return null;

  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const groupCount = (id: string) => accounts.filter((a) => a.groupId === id).length;
  const tagCount = (id: string) => accounts.filter((a) => a.tagIds.includes(id)).length;

  return (
    <div className="grid grid-cols-2 gap-6">
      <section>
        <h1 className="readout mb-3 text-[15px] text-ink">分组 · {groups.length}</h1>
        <CreateRow placeholder="新分组名称" onCreate={async (name) => void (await saveGroup({ name }))} />
        {sortedGroups.length === 0 ? (
          <EmptyState icon="▣" text="分组用于 popup 主列表的折叠展示，如「常用站 / 备用站」" />
        ) : (
          <ul className="mt-3 space-y-1.5">
            {sortedGroups.map((g, i) => (
              <EditableRow
                key={g.id}
                name={g.name}
                meta={`${groupCount(g.id)} 个账号`}
                onRename={(name) => saveGroup({ id: g.id, name })}
                onDelete={async () => {
                  await deleteGroup(g.id);
                  toast(`已删除分组「${g.name}」，组内账号移入未分组`);
                }}
                deleteHint={
                  groupCount(g.id) > 0
                    ? `组内 ${groupCount(g.id)} 个账号将变为「未分组」（账号本身保留）`
                    : "该分组为空"
                }
                extra={
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      disabled={i === 0}
                      onClick={() => {
                        const ids = sortedGroups.map((x) => x.id);
                        [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                        void reorderGroups(ids);
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      disabled={i === sortedGroups.length - 1}
                      onClick={() => {
                        const ids = sortedGroups.map((x) => x.id);
                        [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
                        void reorderGroups(ids);
                      }}
                    >
                      ↓
                    </Button>
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h1 className="readout mb-3 text-[15px] text-ink">标签 · {tags.length}</h1>
        <CreateRow placeholder="新标签名称" onCreate={async (name) => void (await saveTag({ name }))} />
        {tags.length === 0 ? (
          <EmptyState icon="#" text="标签用于 popup 的快速筛选，一个账号可挂多个标签" />
        ) : (
          <ul className="mt-3 space-y-1.5">
            {tags.map((t) => (
              <EditableRow
                key={t.id}
                name={t.name}
                meta={`${tagCount(t.id)} 个账号引用`}
                onRename={(name) => saveTag({ id: t.id, name })}
                onDelete={async () => {
                  await deleteTag(t.id);
                  toast(`已删除标签「${t.name}」`);
                }}
                deleteHint={
                  tagCount(t.id) > 0
                    ? `${tagCount(t.id)} 个账号上的该标签将被移除`
                    : "该标签未被引用"
                }
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CreateRow({
  placeholder,
  onCreate,
}: {
  placeholder: string;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
    setName("");
  }
  return (
    <div className="flex gap-2">
      <Input
        value={name}
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void create()}
      />
      <Button variant="phos" onClick={create}>
        创建
      </Button>
    </div>
  );
}

function EditableRow({
  name,
  meta,
  extra,
  deleteHint,
  onRename,
  onDelete,
}: {
  name: string;
  meta: string;
  extra?: ReactNode;
  deleteHint: string;
  onRename: (name: string) => Promise<unknown>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [confirming, setConfirming] = useState(false);

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) await onRename(trimmed);
    setEditing(false);
  }

  return (
    <li className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2">
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && void commit()}
          className="py-0.5"
        />
      ) : (
        <>
          <span className="flex-1 truncate text-[13px]">{name}</span>
          <span className="text-[11px] text-ink-faint">{meta}</span>
        </>
      )}
      {extra}
      <Button
        size="sm"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
      >
        ✎
      </Button>
      <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
        ×
      </Button>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title={`删除「${name}」`}>
        <p className="text-[13px] text-ink-mute">{deleteHint}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConfirming(false)}>取消</Button>
          <Button
            variant="danger"
            onClick={async () => {
              setConfirming(false);
              await onDelete();
            }}
          >
            删除
          </Button>
        </div>
      </Dialog>
    </li>
  );
}
