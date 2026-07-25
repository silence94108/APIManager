import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight, Hand, KeyRound, LayoutGrid } from "lucide-react";
import { canCheckin, resolveCheckinPageUrl } from "@/checkin/helpers";
import { deleteAccount } from "@/storage/accounts";
import { setGroupCollapsed } from "@/storage/groupsTags";
import { accountsItem, groupsItem, tagsItem } from "@/storage/items";
import { SITE_TYPE_LABELS, OAUTH_PROVIDER_LABELS, type Account, type Group } from "@/types";
import { formatUsd, sumBalanceUsd } from "@/utils/quota";
import {
  AccountFormDialog,
  EMPTY_FORM,
  type FormState,
  toForm,
} from "@/ui/AccountFormDialog";
import { ApiKeyPickerDialog, copyApiKey } from "@/ui/ApiKeyPicker";
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
import { useStorageItem, useVaultGate } from "@/ui/hooks";
import { UnlockDialog } from "@/ui/UnlockDialog";

interface Section {
  key: string;
  group: Group | null;
  accounts: Account[];
  balance: number;
}

const GRID_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3";

export default function AccountsPage() {
  const accounts = useStorageItem(accountsItem);
  const groups = useStorageItem(groupsItem);
  const tags = useStorageItem(tagsItem);

  const [editing, setEditing] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  /** 多条密钥时弹选择列表；单条直接复制 */
  const [pickingKeys, setPickingKeys] = useState<Account | null>(null);
  // 未分组区块的折叠态——不落在 Group 上，仅本页会话内记忆
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);
  const { gate, unlockDialogProps } = useVaultGate();

  const tagName = useMemo(() => {
    const map = new Map((tags ?? []).map((t) => [t.id, t.name]));
    return (id: string) => map.get(id);
  }, [tags]);

  // 与 popup 同一契约：分组按 sortOrder 排序、未分组垫底；空组也显示，便于看到组的存在
  const sections = useMemo<Section[]>(() => {
    const grouped: Section[] = [...(groups ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => {
        const list = (accounts ?? []).filter((a) => a.groupId === g.id);
        return { key: g.id, group: g, accounts: list, balance: sumBalanceUsd(list) };
      });
    const ungrouped = (accounts ?? []).filter((a) => !a.groupId);
    if (ungrouped.length) {
      grouped.push({
        key: "__ungrouped",
        group: null,
        accounts: ungrouped,
        balance: sumBalanceUsd(ungrouped),
      });
    }
    return grouped;
  }, [accounts, groups]);

  if (!accounts) return null;

  const renderCard = (account: Account) => {
    const tagBadges = account.tagIds
      .map((id) => {
        const name = tagName(id);
        return name ? (
          <Badge key={id} tone="mute">
            {name}
          </Badge>
        ) : null;
      })
      .filter(Boolean);
    return (
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
          {(account.apiKeys?.length ?? 0) > 0 && (
            <button
              title="复制 API 密钥"
              onClick={() => {
                const keys = account.apiKeys!;
                if (keys.length === 1) gate(() => void copyApiKey(keys[0]));
                else setPickingKeys(account);
              }}
              className="rounded p-1 text-ink-mute opacity-70 transition hover:bg-carbon hover:text-phos group-hover:opacity-100"
            >
              <KeyRound size={14} />
            </button>
          )}
          {/* 与 popup 行同一显隐契约：可自动签，或不参与但配了自定义签到链接（仅记录型）也给手动入口 */}
          {(canCheckin(account) || !!account.checkinPageUrl?.trim()) && (
            <button
              title="去签到页"
              onClick={() => void browser.tabs.create({ url: resolveCheckinPageUrl(account) })}
              className="rounded p-1 text-ink-mute opacity-70 transition hover:bg-carbon hover:text-phos group-hover:opacity-100"
            >
              <Hand size={14} />
            </button>
          )}
          <button
            title="打开站点"
            onClick={() => void browser.tabs.create({ url: account.url })}
            className="rounded p-1 text-ink-mute opacity-70 transition hover:bg-carbon hover:text-phos group-hover:opacity-100"
          >
            <ArrowUpRight size={14} />
          </button>
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

        {/* 标签（分组名已由区块头承载，卡片内不重复） */}
        {tagBadges.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-mute">
            {tagBadges}
          </div>
        )}

        {/* 底部：余额 + 操作 */}
        <div className="mt-auto flex items-end justify-between border-t border-line/60 pt-2.5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">余额</p>
            <p className="readout text-[15px] text-ink">
              {account.balance ? formatUsd(account.balance.usd) : "—"}
            </p>
            {account.usage && (account.usage.todayUsd !== undefined || account.usage.totalUsd !== undefined) && (
              <p className="readout mt-0.5 text-[10px] text-ink-faint">
                {account.usage.todayUsd !== undefined && `今日 ${formatUsd(account.usage.todayUsd)}`}
                {account.usage.todayUsd !== undefined && account.usage.totalUsd !== undefined && " · "}
                {account.usage.totalUsd !== undefined && `累计 ${formatUsd(account.usage.totalUsd)}`}
              </p>
            )}
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
    );
  };

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
          icon={<LayoutGrid size={24} />}
          text="还没有账号——添加一个中转站账号，或在「数据」页导入 all-api-hub 备份"
          action={
            <Button variant="phos" onClick={() => setEditing({ ...EMPTY_FORM })}>
              添加第一个账号
            </Button>
          }
        />
      ) : (groups ?? []).length === 0 ? (
        // 从未建过分组——保持平铺网格，不套多余的"未分组"组头
        <div className={GRID_CLASS}>{accounts.map(renderCard)}</div>
      ) : (
        <div className="space-y-2">
          {sections.map((section) => {
            const collapsed = section.group ? section.group.collapsed : ungroupedCollapsed;
            return (
              <section key={section.key}>
                <button
                  onClick={() => {
                    if (section.group) void setGroupCollapsed(section.group.id, !collapsed);
                    else setUngroupedCollapsed(!collapsed);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition hover:bg-raised/60"
                  title={collapsed ? "展开分组" : "收起分组"}
                >
                  <ChevronRight
                    size={12}
                    className={cn(
                      "shrink-0 text-ink-faint transition-transform",
                      !collapsed && "rotate-90",
                    )}
                  />
                  <span className="truncate text-[12px] font-medium text-ink-mute">
                    {section.group?.name ?? "未分组"}
                  </span>
                  <span className="text-[11px] text-ink-faint">{section.accounts.length}</span>
                  <span className="readout ml-auto text-[12px] text-ink-mute">
                    {formatUsd(section.balance)}
                  </span>
                </button>
                {!collapsed &&
                  (section.accounts.length === 0 ? (
                    <p className="px-2 pb-1.5 pt-0.5 text-[11px] text-ink-faint">组内暂无账号</p>
                  ) : (
                    <div className={cn(GRID_CLASS, "mt-1.5")}>
                      {section.accounts.map(renderCard)}
                    </div>
                  ))}
              </section>
            );
          })}
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

      {pickingKeys && (
        <ApiKeyPickerDialog
          account={pickingKeys}
          onPick={(k) => {
            setPickingKeys(null);
            gate(() => void copyApiKey(k));
          }}
          onClose={() => setPickingKeys(null)}
        />
      )}

      <UnlockDialog {...unlockDialogProps} />

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
