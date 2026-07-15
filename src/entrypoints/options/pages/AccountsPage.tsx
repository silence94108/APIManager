import { useMemo, useState } from "react";
import { deleteAccount, saveAccount, type AccountDraft } from "@/storage/accounts";
import { accountsItem, groupsItem, tagsItem } from "@/storage/items";
import { SITE_TYPES, SITE_TYPE_LABELS, type Account, type SiteType } from "@/types";
import { formatUsd } from "@/utils/quota";
import { isValidSiteUrl, normalizeOrigin } from "@/utils/url";
import {
  Badge,
  Button,
  cn,
  ConfirmDialog,
  Dialog,
  dotStatus,
  EmptyState,
  Field,
  Input,
  Select,
  StatusDot,
  TagChip,
  toast,
  Toggle,
} from "@/ui/components";
import { useStorageItem } from "@/ui/hooks";

interface FormState {
  id?: string;
  name: string;
  url: string;
  siteType: SiteType;
  userId: string;
  accessToken: string;
  username: string;
  groupId: string;
  tagIds: string[];
  notes: string;
  disabled: boolean;
  checkinEnabled: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  url: "",
  siteType: "new-api",
  userId: "",
  accessToken: "",
  username: "",
  groupId: "",
  tagIds: [],
  notes: "",
  disabled: false,
  checkinEnabled: true,
};

function toForm(account: Account): FormState {
  return {
    id: account.id,
    name: account.name,
    url: account.url,
    siteType: account.siteType,
    userId: account.userId,
    accessToken: account.accessToken ?? "",
    username: account.username ?? "",
    groupId: account.groupId ?? "",
    tagIds: account.tagIds,
    notes: account.notes ?? "",
    disabled: account.disabled,
    checkinEnabled: account.checkinEnabled,
  };
}

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

function AccountFormDialog({
  initial,
  groups,
  tags,
  onClose,
}: {
  initial: FormState;
  groups: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<"name" | "url" | "userId" | "accessToken", string>>>({});
  const isAnyrouter = form.siteType === "anyrouter";
  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  async function submit() {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = "必填";
    if (!isValidSiteUrl(form.url)) next.url = "URL 无效";
    if (!isAnyrouter) {
      if (!form.accessToken.trim()) next.accessToken = "token 模式必填";
      if (!form.userId.trim()) next.userId = "必填（站点后台的用户 ID）";
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const draft: AccountDraft = {
      id: form.id,
      name: form.name.trim(),
      url: normalizeOrigin(form.url),
      siteType: form.siteType,
      authType: isAnyrouter ? "cookie" : "token",
      userId: form.userId.trim(),
      accessToken: form.accessToken.trim() || undefined,
      username: form.username.trim() || undefined,
      groupId: form.groupId || null,
      tagIds: form.tagIds,
      notes: form.notes.trim() || undefined,
      disabled: form.disabled,
      checkinEnabled: form.checkinEnabled,
      // 编辑时重新提交 token 视为已更新，清除过期标记
      tokenState: "ok",
    };
    await saveAccount(draft);
    toast(form.id ? "账号已更新" : "账号已添加");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={form.id ? "编辑账号" : "添加账号"} wide>
      <div className="grid grid-cols-2 gap-4">
        <Field label="站点名称">
          <Input
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="我的中转站"
          />
          {errors.name && <span className="text-[11px] text-signal">{errors.name}</span>}
        </Field>
        <Field label="站点 URL">
          <Input
            value={form.url}
            onChange={(e) => set({ url: e.target.value })}
            onBlur={() => isValidSiteUrl(form.url) && set({ url: normalizeOrigin(form.url) })}
            placeholder="https://api.example.com"
          />
          {errors.url && <span className="text-[11px] text-signal">{errors.url}</span>}
        </Field>

        <Field label="站点类型">
          <Select
            value={form.siteType}
            onChange={(e) => set({ siteType: e.target.value as SiteType })}
          >
            {SITE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SITE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="用户 ID"
          hint={isAnyrouter ? "选填——AnyRouter 走浏览器登录态" : "站点「个人设置」页的数字 ID"}
        >
          <Input value={form.userId} onChange={(e) => set({ userId: e.target.value })} placeholder="1234" />
          {errors.userId && <span className="text-[11px] text-signal">{errors.userId}</span>}
        </Field>

        <div className="col-span-2">
          <Field
            label={isAnyrouter ? "Access Token（选填）" : "Access Token"}
            hint={
              isAnyrouter
                ? "AnyRouter 签到复用浏览器 Cookie，请保持该站在浏览器中已登录"
                : form.siteType === "voapi-v2"
                  ? "VoAPI v2 使用页面 JWT（会过期，过期后在此更新）"
                  : "站点「个人设置」生成的访问令牌"
            }
          >
            <Input
              value={form.accessToken}
              onChange={(e) => set({ accessToken: e.target.value })}
              placeholder={isAnyrouter ? "留空即可" : "sk-… / eyJ…"}
              type="password"
              autoComplete="off"
            />
            {errors.accessToken && <span className="text-[11px] text-signal">{errors.accessToken}</span>}
          </Field>
        </div>

        <Field label="分组">
          <Select value={form.groupId} onChange={(e) => set({ groupId: e.target.value })}>
            <option value="">未分组</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="用户名（备注用）">
          <Input value={form.username} onChange={(e) => set({ username: e.target.value })} />
        </Field>

        <div className="col-span-2">
          <Field label="标签">
            {tags.length === 0 ? (
              <p className="text-[12px] text-ink-faint">还没有标签，可在「分组与标签」页创建</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const active = form.tagIds.includes(t.id);
                  return (
                    <TagChip
                      key={t.id}
                      active={active}
                      onClick={() =>
                        set({
                          tagIds: active
                            ? form.tagIds.filter((id) => id !== t.id)
                            : [...form.tagIds, t.id],
                        })
                      }
                    >
                      {t.name}
                    </TagChip>
                  );
                })}
              </div>
            )}
          </Field>
        </div>

        <div className="col-span-2">
          <Field label="备注">
            <Input value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>

        <div className="col-span-2 flex items-center gap-6 border-t border-line pt-3">
          <Toggle
            checked={form.checkinEnabled}
            onChange={(v) => set({ checkinEnabled: v })}
            label="参与自动签到"
          />
          <Toggle checked={form.disabled} onChange={(v) => set({ disabled: v })} label="禁用账号" />
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>取消</Button>
        <Button variant="phos" onClick={submit}>
          {form.id ? "保存" : "添加"}
        </Button>
      </div>
    </Dialog>
  );
}
