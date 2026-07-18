import { useMemo, useState } from "react";
import { deleteAccount } from "@/storage/accounts";
import { accountsItem, groupsItem, tagsItem } from "@/storage/items";
import { SITE_TYPE_LABELS, OAUTH_PROVIDER_LABELS, type Account } from "@/types";
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
  SiteAvatar,
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => (
            <div
              key={account.id}
              className={cn(
                "group flex flex-col gap-3 rounded-lg border border-line bg-panel p-3.5 transition hover:border-ink-faint/40",
                account.disabled && "opacity-60",
              )}
            >
              {/* 头部：头像 + 名称/URL + 状态点 */}
              <div className="flex items-start gap-2.5">
                <SiteAvatar name={account.name} faviconUrl={account.faviconUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p
                      className={cn(
                        "truncate text-[13px] text-ink",
                        account.disabled && "line-through",
                      )}
                    >
                      {account.name}
                    </p>
                  </div>
                  <p className="readout truncate text-[11px] text-ink-faint">{account.url}</p>
                </div>
                <StatusDot status={dotStatus(account)} />
              </div>

              {/* 徽章行：类型 + 过期 + 凭证 */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="mute">{SITE_TYPE_LABELS[account.siteType]}</Badge>
                {account.tokenState === "expired" && <Badge tone="amber">Token 过期</Badge>}
                {account.credential && (
                  <Badge tone="mute">
                    {account.credential.kind === "password"
                      ? "账密"
                      : `OAuth·${OAUTH_PROVIDER_LABELS[account.credential.provider]}`}
                  </Badge>
                )}
              </div>

              {/* 分组 + 标签 */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-mute">
                <span className="text-ink-faint">{groupName(account.groupId)}</span>
                {account.tagIds.map((id) => {
                  const name = tagName(id);
                  return name ? (
                    <Badge key={id} tone="mute">
                      {name}
                    </Badge>
                  ) : null;
                })}
              </div>

              {/* 底部：余额 + 操作 */}
              <div className="mt-auto flex items-end justify-between border-t border-line/60 pt-2.5">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">余额</p>
                  <p className="readout text-[15px] text-ink">
                    {account.balance ? formatUsd(account.balance.usd) : "—"}
                  </p>
                </div>
                <div className="flex gap-1.5 opacity-70 transition group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    size="sm"
                    onClick={() => {
                      void browser.tabs.create({ url: account.url });
                      toast("已打开站点——登录后点扩展弹窗的「识别」即可更新该账号");
                    }}
                    title="打开站点后用扩展弹窗识别，可刷新登录态"
                  >
                    重新识别
                  </Button>
                  <Button size="sm" onClick={() => setEditing(toForm(account))}>
                    编辑
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleting(account)}>
                    删除
                  </Button>
                </div>
              </div>
            </div>
          ))}
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
