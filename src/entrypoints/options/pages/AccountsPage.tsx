import { useMemo, useState } from "react";
import { deleteAccount } from "@/storage/accounts";
import { accountsItem, groupsItem, tagsItem } from "@/storage/items";
import { SITE_TYPE_LABELS, type Account } from "@/types";
import { formatUsd } from "@/utils/quota";
import {
  AccountFormDialog,
  EMPTY_FORM,
  type FormState,
  toForm,
} from "@/ui/AccountFormDialog";
import {
  Badge,
  Button,
  cn,
  ConfirmDialog,
  dotStatus,
  EmptyState,
  StatusDot,
  toast,
} from "@/ui/components";
import { useStorageItem } from "@/ui/hooks";

export default function AccountsPage() {
  const accounts = useStorageItem(accountsItem);
  const groups = useStorageItem(groupsItem);
  const tags = useStorageItem(tagsItem);

  const [editing, setEditing] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  const groupName = useMemo(() => {
    const map = new Map((groups ?? []).map((g) => [g.id, g.name]));
    return (id: string | null) => (id ? (map.get(id) ?? "—") : "未分组");
  }, [groups]);

  const tagName = useMemo(() => {
    const map = new Map((tags ?? []).map((t) => [t.id, t.name]));
    return (id: string) => map.get(id);
  }, [tags]);

  if (!accounts) return null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="readout text-[15px] text-ink">账号 · {accounts.length}</h1>
        <Button variant="phos" onClick={() => setEditing({ ...EMPTY_FORM })}>
          + 添加账号
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon="▦"
          text="还没有账号——添加一个中转站账号，或在「数据」页导入 all-api-hub 备份"
          action={
            <Button variant="phos" onClick={() => setEditing({ ...EMPTY_FORM })}>
              添加第一个账号
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                <th className="px-3 py-2 font-normal">站点</th>
                <th className="px-3 py-2 font-normal">类型</th>
                <th className="px-3 py-2 font-normal">分组</th>
                <th className="px-3 py-2 font-normal">标签</th>
                <th className="px-3 py-2 text-right font-normal">余额</th>
                <th className="px-3 py-2 text-right font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b border-line/50 last:border-0 hover:bg-raised/40">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <StatusDot status={dotStatus(account)} />
                      <div className="min-w-0">
                        <p className={cn("truncate", account.disabled && "text-ink-faint line-through")}>
                          {account.name}
                          {account.tokenState === "expired" && (
                            <span className="ml-1.5">
                              <Badge tone="amber">Token 过期</Badge>
                            </span>
                          )}
                        </p>
                        <p className="readout truncate text-[11px] text-ink-faint">{account.url}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-ink-mute">{SITE_TYPE_LABELS[account.siteType]}</td>
                  <td className="px-3 py-2 text-ink-mute">{groupName(account.groupId)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {account.tagIds.map((id) => {
                        const name = tagName(id);
                        return name ? (
                          <Badge key={id} tone="mute">
                            {name}
                          </Badge>
                        ) : null;
                      })}
                    </div>
                  </td>
                  <td className="readout px-3 py-2 text-right text-ink">
                    {account.balance ? formatUsd(account.balance.usd) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" onClick={() => setEditing(toForm(account))}>
                        编辑
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleting(account)}>
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <AccountFormDialog
          initial={editing}
          groups={groups ?? []}
          tags={tags ?? []}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="删除账号"
        message={
          <>
            确定删除 <span className="text-ink">{deleting?.name}</span>
            ？该操作不可撤销（站点上的账号不受影响）。
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteAccount(deleting.id);
          setDeleting(null);
          toast(`已删除 ${deleting.name}`);
        }}
      />
    </div>
  );
}
