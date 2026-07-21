import { useRef, useState } from "react";
import { X } from "lucide-react";
import { saveAccount, type AccountDraft } from "@/storage/accounts";
import { vaultMetaItem } from "@/storage/items";
import { sendMessage } from "@/messaging/protocol";
import type { DetectedAccount } from "@/detect/types";
import { CHECKIN_PAGE_PATHS } from "@/checkin/helpers";
import {
  OAUTH_PROVIDER_LABELS,
  OAUTH_PROVIDERS,
  BALANCE_SITE_TYPES,
  SITE_TYPES,
  SITE_TYPE_LABELS,
  type Account,
  type ApiKeyEntry,
  type EncryptedBlob,
  type OAuthProvider,
  type SiteType,
} from "@/types";
import { isValidSiteUrl, normalizeOrigin } from "@/utils/url";
import { decryptSecret, encryptSecret, isVaultUnlocked } from "@/vault/vault";
import { Button, Dialog, Field, Input, Select, TagChip, toast, Toggle } from "@/ui/components";
import { useStorageItem } from "@/ui/hooks";
import { UnlockDialog } from "@/ui/UnlockDialog";

type CredKind = "none" | "password" | "oauth";

/** API 密钥表单行——已有条目带 keyEnc（key 输入留空不改），新增条目只有 plainKey 明文 */
export interface FormApiKey {
  id: string;
  name: string;
  keyEnc?: EncryptedBlob;
  plainKey: string;
  createdAt?: number;
}

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
  /** 自定义签到页链接——留空用站点类型默认路径 */
  checkinPageUrl: string;
  disabled: boolean;
  checkinEnabled: boolean;
  credKind: CredKind;
  credUsername: string;
  /** 明文输入区——编辑已有密码时留空表示保持不变 */
  credPassword: string;
  /** 编辑时透传已有密文，留空不改则原样保存 */
  passwordEnc?: EncryptedBlob;
  oauthProvider: OAuthProvider;
  oauthIdentity: string;
  /** API 密钥列表——空行（无密文无明文）提交时静默丢弃 */
  apiKeys: FormApiKey[];
  /** 站点 favicon URL——透传字段，识别时带入、编辑时保留，无可编辑 UI */
  faviconUrl?: string;
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
  checkinPageUrl: "",
  disabled: false,
  checkinEnabled: true,
  credKind: "none",
  credUsername: "",
  credPassword: "",
  oauthProvider: "linuxdo",
  oauthIdentity: "",
  apiKeys: [],
};

export function toForm(account: Account): FormState {
  const cred = account.credential;
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
    checkinPageUrl: account.checkinPageUrl ?? "",
    disabled: account.disabled,
    checkinEnabled: account.checkinEnabled,
    credKind: cred?.kind ?? "none",
    credUsername: cred?.kind === "password" ? cred.username : "",
    credPassword: "",
    passwordEnc: cred?.kind === "password" ? cred.passwordEnc : undefined,
    oauthProvider: cred?.kind === "oauth" ? cred.provider : "linuxdo",
    oauthIdentity: cred?.kind === "oauth" ? (cred.identity ?? "") : "",
    apiKeys: (account.apiKeys ?? []).map((k) => ({
      id: k.id,
      name: k.name,
      keyEnc: k.keyEnc,
      plainKey: "",
      createdAt: k.createdAt,
    })),
    faviconUrl: account.faviconUrl,
  };
}

/** 识别草稿 → 新增表单预填态：站点名优先用网页标题，读不到则取 hostname，其余按识别结果填，用户可改 */
export function fromDetected(d: DetectedAccount): FormState {
  let name = d.title?.trim() ?? "";
  if (!name) {
    try {
      name = new URL(d.url).hostname;
    } catch {
      name = d.url;
    }
  }
  return {
    ...EMPTY_FORM,
    name,
    url: d.url,
    siteType: d.siteType,
    userId: d.userId,
    accessToken: d.accessToken ?? "",
    username: d.username ?? "",
    faviconUrl: d.faviconUrl,
  };
}

/**
 * 已存在账号 + 本次识别草稿 → 编辑态表单：
 * 保留原账号的分组/标签/备注/凭证/名称，用识别到的新登录态覆盖 token / favicon / 用户名，
 * 并清除过期标记（重新识别意味着登录态已刷新）。带 id 走更新而非新建。
 */
export function mergeDetectedIntoAccount(existing: Account, d: DetectedAccount): FormState {
  const base = toForm(existing);
  return {
    ...base,
    siteType: d.siteType,
    accessToken: d.accessToken ?? base.accessToken,
    username: d.username?.trim() || base.username,
    faviconUrl: d.faviconUrl ?? base.faviconUrl,
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
  const [errors, setErrors] = useState<
    Partial<
      Record<
        "name" | "url" | "userId" | "accessToken" | "credUsername" | "credPassword" | "apiKeys",
        string
      >
    >
  >({});
  const [showUnlock, setShowUnlock] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  /** 已解密显示的 API 密钥明文——按行 id 记录 */
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  /** 需解锁的操作暂存于此，解锁成功后续跑 */
  const pendingRef = useRef<(() => void) | null>(null);
  const vaultMeta = useStorageItem(vaultMetaItem);
  const isAnyrouter = form.siteType === "anyrouter";
  // sub2api：token 拉余额但无「兼容用户 ID」概念；other：纯记录，token/userId 均不强制
  const isSub2api = form.siteType === "sub2api";
  const isOther = form.siteType === "other";
  const requiresUserId = !isAnyrouter && !isSub2api && !isOther;
  const requiresToken = !isAnyrouter && !isOther;
  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  function requireUnlock(action: () => void) {
    void isVaultUnlocked().then((unlocked) => {
      if (unlocked) {
        action();
      } else {
        pendingRef.current = action;
        setShowUnlock(true);
      }
    });
  }

  function revealPassword() {
    if (!form.passwordEnc) return;
    decryptSecret(form.passwordEnc)
      .then(setRevealed)
      .catch(() => toast("解密失败，密文可能来自其他主密码", "err"));
  }

  function copyPassword() {
    if (!form.passwordEnc) return;
    decryptSecret(form.passwordEnc)
      .then((plain) => navigator.clipboard.writeText(plain))
      .then(() => toast("密码已复制"))
      .catch(() => toast("解密失败，密文可能来自其他主密码", "err"));
  }

  const setKeyRow = (id: string, patch: Partial<FormApiKey>) =>
    set({ apiKeys: form.apiKeys.map((k) => (k.id === id ? { ...k, ...patch } : k)) });

  const removeKeyRow = (id: string) => {
    set({ apiKeys: form.apiKeys.filter((k) => k.id !== id) });
    setRevealedKeys(({ [id]: _, ...rest }) => rest);
  };

  function revealKey(row: FormApiKey) {
    if (!row.keyEnc) return;
    decryptSecret(row.keyEnc)
      .then((plain) => setRevealedKeys((m) => ({ ...m, [row.id]: plain })))
      .catch(() => toast("解密失败，密文可能来自其他主密码", "err"));
  }

  function copyKey(row: FormApiKey) {
    if (!row.keyEnc) return;
    decryptSecret(row.keyEnc)
      .then((plain) => navigator.clipboard.writeText(plain))
      .then(() => toast("API 密钥已复制"))
      .catch(() => toast("解密失败，密文可能来自其他主密码", "err"));
  }

  async function submit() {
    const next: typeof errors = {};
    const hasCredential = form.credKind !== "none";
    if (!form.name.trim()) next.name = "必填";
    if (!isValidSiteUrl(form.url)) next.url = "URL 无效";
    // 仅凭证账号放宽：有凭证且 token / 用户 ID 均留空 → 只做记录，不参与余额签到
    const credentialOnly = hasCredential && !form.accessToken.trim() && !form.userId.trim();
    if (!credentialOnly) {
      if (requiresToken && !form.accessToken.trim()) next.accessToken = "token 模式必填";
      if (requiresUserId && !form.userId.trim()) next.userId = "必填（站点后台的用户 ID）";
    }
    if (form.credKind === "password") {
      if (!form.credUsername.trim()) next.credUsername = "必填";
      if (!form.credPassword && !form.passwordEnc) next.credPassword = "必填";
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    // 密码或新增 API 密钥要加密落盘——统一检查 vault 状态，解锁成功后续跑本函数
    const newPlainKeys = form.apiKeys.filter((k) => k.plainKey.trim());
    const needsEncrypt =
      (form.credKind === "password" && !!form.credPassword) || newPlainKeys.length > 0;
    if (needsEncrypt) {
      if (vaultMeta == null) {
        const msg = "需先设置主密码（设置 → 安全）";
        setErrors({
          ...next,
          ...(form.credKind === "password" && form.credPassword ? { credPassword: msg } : {}),
          ...(newPlainKeys.length ? { apiKeys: msg } : {}),
        });
        return;
      }
      if (!(await isVaultUnlocked())) {
        pendingRef.current = () => void submit();
        setShowUnlock(true);
        return;
      }
    }

    let credential: Account["credential"];
    if (form.credKind === "password") {
      let passwordEnc = form.passwordEnc;
      if (form.credPassword) passwordEnc = await encryptSecret(form.credPassword);
      credential = { kind: "password", username: form.credUsername.trim(), passwordEnc: passwordEnc! };
    } else if (form.credKind === "oauth") {
      credential = {
        kind: "oauth",
        provider: form.oauthProvider,
        identity: form.oauthIdentity.trim() || undefined,
      };
    }

    // API 密钥组装：新明文加密、已有密文原样保留、空行静默丢弃
    const apiKeys: ApiKeyEntry[] = [];
    for (const row of form.apiKeys) {
      const plain = row.plainKey.trim();
      if (plain) {
        apiKeys.push({
          id: row.id,
          name: row.name.trim(),
          keyEnc: await encryptSecret(plain),
          createdAt: row.createdAt ?? Date.now(),
        });
      } else if (row.keyEnc) {
        apiKeys.push({
          id: row.id,
          name: row.name.trim(),
          keyEnc: row.keyEnc,
          createdAt: row.createdAt ?? Date.now(),
        });
      }
    }

    const draft: AccountDraft = {
      id: form.id,
      name: form.name.trim(),
      url: normalizeOrigin(form.url),
      siteType: form.siteType,
      authType: isAnyrouter ? "cookie" : "token",
      userId: form.userId.trim(),
      accessToken: form.accessToken.trim() || undefined,
      username: form.username.trim() || undefined,
      faviconUrl: form.faviconUrl,
      credential,
      apiKeys: apiKeys.length ? apiKeys : undefined,
      groupId: form.groupId || null,
      tagIds: form.tagIds,
      notes: form.notes.trim() || undefined,
      checkinPageUrl: form.checkinPageUrl.trim() || undefined,
      disabled: form.disabled,
      checkinEnabled: form.checkinEnabled,
      // 编辑时重新提交 token 视为已更新，清除过期标记
      tokenState: "ok",
    };
    const saved = await saveAccount(draft);
    toast(form.id ? "账号已更新" : "账号已添加");
    onClose();
    // 新增账号后台顺手拉一次余额，不阻塞关闭；无余额接口 / 仅凭证账号跳过
    if (
      !form.id &&
      BALANCE_SITE_TYPES.includes(saved.siteType) &&
      (saved.authType !== "token" || saved.accessToken)
    ) {
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
          label={requiresUserId ? "用户 ID" : "用户 ID（选填）"}
          hint={
            isAnyrouter
              ? "选填——AnyRouter 走浏览器登录态"
              : isSub2api
                ? "选填——Sub2API 无需兼容用户 ID"
                : isOther
                  ? "选填——其他类型仅作记录"
                  : "站点「个人设置」页的数字 ID"
          }
        >
          <Input value={form.userId} onChange={(e) => set({ userId: e.target.value })} placeholder="1234" />
          {errors.userId && <span className="text-[11px] text-signal">{errors.userId}</span>}
        </Field>

        <div className="sm:col-span-2">
          <Field
            label={requiresToken ? "Access Token" : "Access Token（选填）"}
            hint={
              isAnyrouter
                ? "AnyRouter 签到复用浏览器 Cookie，请保持该站在浏览器中已登录"
                : isSub2api
                  ? "Sub2API 的访问令牌，用于查询余额"
                  : isOther
                    ? "其他类型仅作记录，可留空"
                    : form.siteType === "voapi-v2"
                      ? "VoAPI v2 使用页面 JWT（会过期，过期后在此更新）"
                      : "站点「个人设置」生成的访问令牌"
            }
          >
            <Input
              value={form.accessToken}
              onChange={(e) => set({ accessToken: e.target.value })}
              placeholder={requiresToken ? "sk-… / eyJ…" : "留空即可"}
              type="password"
              autoComplete="off"
            />
            {errors.accessToken && <span className="text-[11px] text-signal">{errors.accessToken}</span>}
          </Field>
        </div>

        <div className="border-t border-line pt-3 sm:col-span-2">
          <Field label="登录凭证" hint="站点的登录方式——密码以主密码加密后仅存本地；仅凭证账号可不填 token">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["none", "无"],
                  ["password", "账号密码"],
                  ["oauth", "OAuth 授权"],
                ] as const
              ).map(([kind, label]) => (
                <TagChip key={kind} active={form.credKind === kind} onClick={() => set({ credKind: kind })}>
                  {label}
                </TagChip>
              ))}
            </div>
          </Field>

          {form.credKind === "password" && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="登录用户名">
                <Input
                  value={form.credUsername}
                  onChange={(e) => set({ credUsername: e.target.value })}
                  autoComplete="off"
                />
                {errors.credUsername && (
                  <span className="text-[11px] text-signal">{errors.credUsername}</span>
                )}
              </Field>
              <Field label="登录密码" hint={form.passwordEnc ? "已加密保存——留空保持不变" : undefined}>
                <Input
                  type="password"
                  value={form.credPassword}
                  onChange={(e) => set({ credPassword: e.target.value })}
                  placeholder={form.passwordEnc ? "••••••（留空不改）" : "站点登录密码"}
                  autoComplete="new-password"
                />
                {errors.credPassword && (
                  <span className="text-[11px] text-signal">{errors.credPassword}</span>
                )}
              </Field>
              {vaultMeta === null && (
                <p className="text-[11px] text-amber sm:col-span-2">
                  保存密码前需先设置主密码——
                  <button type="button" className="underline" onClick={openSecuritySettings}>
                    去「安全」页设置
                  </button>
                </p>
              )}
              {form.passwordEnc && (
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Button
                    size="sm"
                    onClick={() => (revealed ? setRevealed(null) : requireUnlock(revealPassword))}
                  >
                    {revealed ? "隐藏" : "显示密码"}
                  </Button>
                  <Button size="sm" onClick={() => requireUnlock(copyPassword)}>
                    复制密码
                  </Button>
                  {revealed && (
                    <span className="readout break-all text-[12px] text-ink">{revealed}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {form.credKind === "oauth" && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="授权方式">
                <Select
                  value={form.oauthProvider}
                  onChange={(e) => set({ oauthProvider: e.target.value as OAuthProvider })}
                >
                  {OAUTH_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {OAUTH_PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="授权身份（选填）" hint="如授权用的 LinuxDo 用户名，便于区分同站多号">
                <Input
                  value={form.oauthIdentity}
                  onChange={(e) => set({ oauthIdentity: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </div>
          )}
        </div>

        <div className="border-t border-line pt-3 sm:col-span-2">
          <Field
            label="API 密钥"
            hint="站点生成的 sk- 令牌，以主密码加密存本地——卡片快捷复制与模型测试取用；首条视为主用"
          >
            <div className="space-y-2">
              {form.apiKeys.map((row) => (
                <div key={row.id}>
                  <div className="flex items-center gap-2">
                    <div className="w-32 shrink-0">
                      <Input
                        value={row.name}
                        onChange={(e) => setKeyRow(row.id, { name: e.target.value })}
                        placeholder="备注（选填）"
                        autoComplete="off"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Input
                        type="password"
                        value={row.plainKey}
                        onChange={(e) => setKeyRow(row.id, { plainKey: e.target.value })}
                        placeholder={row.keyEnc ? "••••••（留空不改）" : "sk-…"}
                        autoComplete="off"
                      />
                    </div>
                    {row.keyEnc && (
                      <>
                        <Button
                          size="sm"
                          className="shrink-0"
                          onClick={() =>
                            revealedKeys[row.id]
                              ? setRevealedKeys(({ [row.id]: _, ...rest }) => rest)
                              : requireUnlock(() => revealKey(row))
                          }
                        >
                          {revealedKeys[row.id] ? "隐藏" : "显示"}
                        </Button>
                        <Button
                          size="sm"
                          className="shrink-0"
                          onClick={() => requireUnlock(() => copyKey(row))}
                        >
                          复制
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      className="shrink-0"
                      title="删除该密钥"
                      onClick={() => removeKeyRow(row.id)}
                    >
                      <X size={13} />
                    </Button>
                  </div>
                  {revealedKeys[row.id] && (
                    <p className="readout mt-1 break-all text-[11px] text-ink">
                      {revealedKeys[row.id]}
                    </p>
                  )}
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  onClick={() =>
                    set({
                      apiKeys: [
                        ...form.apiKeys,
                        { id: crypto.randomUUID(), name: "", plainKey: "" },
                      ],
                    })
                  }
                >
                  + 添加密钥
                </Button>
              </div>
              {errors.apiKeys && <span className="text-[11px] text-signal">{errors.apiKeys}</span>}
              {vaultMeta === null && form.apiKeys.some((k) => !k.keyEnc) && (
                <p className="text-[11px] text-amber">
                  保存密钥前需先设置主密码——
                  <button type="button" className="underline" onClick={openSecuritySettings}>
                    去「安全」页设置
                  </button>
                </p>
              )}
            </div>
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

        <div className="sm:col-span-2">
          <Field
            label="签到页链接（选填）"
            hint={`站点签到页不是默认路径时填这里——完整 URL 或 / 开头路径均可；留空用默认 ${CHECKIN_PAGE_PATHS[form.siteType] ?? "站点首页"}`}
          >
            <Input
              value={form.checkinPageUrl}
              onChange={(e) => set({ checkinPageUrl: e.target.value })}
              placeholder={CHECKIN_PAGE_PATHS[form.siteType] ?? "/checkin"}
            />
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

      <UnlockDialog
        open={showUnlock}
        onClose={() => setShowUnlock(false)}
        onUnlocked={() => {
          const fn = pendingRef.current;
          pendingRef.current = null;
          fn?.();
        }}
      />
    </Dialog>
  );
}

function openSecuritySettings() {
  void browser.tabs.create({ url: browser.runtime.getURL("/options.html#security") });
}
