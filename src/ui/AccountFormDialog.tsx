import { useState } from "react";
import { saveAccount, type AccountDraft } from "@/storage/accounts";
import { sendMessage } from "@/messaging/protocol";
import type { DetectedAccount } from "@/detect/types";
import { SITE_TYPES, SITE_TYPE_LABELS, type Account, type SiteType } from "@/types";
import { isValidSiteUrl, normalizeOrigin } from "@/utils/url";
import { Button, Dialog, Field, Input, Select, TagChip, toast, Toggle } from "@/ui/components";

export interface FormState {
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

export const EMPTY_FORM: FormState = {
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

export function toForm(account: Account): FormState {
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

/** 识别草稿 → 新增表单预填态：站点名默认取 hostname，其余按识别结果填，用户可改 */
export function fromDetected(d: DetectedAccount): FormState {
  let name = "";
  try {
    name = new URL(d.url).hostname;
  } catch {
    name = d.url;
  }
  return {
    ...EMPTY_FORM,
    name,
    url: d.url,
    siteType: d.siteType,
    userId: d.userId,
    accessToken: d.accessToken ?? "",
    username: d.username ?? "",
  };
}

/** 添加/编辑账号弹窗——popup 与 options 共用；popup 窄视口下自动落成单列 */
export function AccountFormDialog({
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
    const saved = await saveAccount(draft);
    toast(form.id ? "账号已更新" : "账号已添加");
    onClose();
    // 新增账号后台顺手拉一次余额，不阻塞关闭；拉成功后写回 storage，列表自动显示
    if (!form.id) {
      void sendMessage("refreshBalance", saved.id).then((res) => {
        if (!res.ok) toast(`${saved.name} 余额拉取失败：${res.error}`, "err");
      });
    }
  }

  return (
    <Dialog open onClose={onClose} title={form.id ? "编辑账号" : "添加账号"} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
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

        <div className="sm:col-span-2">
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

        <div className="sm:col-span-2">
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

        <div className="sm:col-span-2">
          <Field label="备注">
            <Input value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>

        <div className="flex items-center gap-6 border-t border-line pt-3 sm:col-span-2">
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
