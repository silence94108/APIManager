import {
  CHECKIN_SITE_TYPES,
  type Account,
  type AccountCheckinRecord,
  type RunSummary,
  type SiteType,
} from "@/types";

/**
 * 各站点类型默认签到页路径（事实来自 all-api-hub 站点定义，docs/reference-all-api-hub.md）。
 * 值可为多候选数组：new-api 新老主题签到页路由不同（默认主题 /console/personal，部分新版
 * 主题 /profile），turnstileAssist 无按钮时才尝试下一候选，点击后只复核状态。
 */
export const CHECKIN_PAGE_PATHS: Partial<Record<SiteType, string | string[]>> = {
  "new-api": ["/console/personal", "/profile"],
  veloera: "/console/personal",
  anyrouter: "/console/topup",
  "voapi-v2": "/checkIn?_userMenuKey=checkIn",
};

/** 类型默认签到页的首候选——UI 提示/占位、"去签到页"按钮等只取单个地址处用 */
export function defaultCheckinPath(siteType: SiteType): string | undefined {
  const raw = CHECKIN_PAGE_PATHS[siteType];
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * 签到页候选地址（各自拼成绝对 URL）：账号自定义链接优先且只此一条；否则取该类型的
 * 全部候选。无任何候选时返回空数组（**不**兜底首页）——turnstileAssist 依此决定放弃，
 * 避免拿站点首页瞎点。
 */
export function resolveCheckinPageUrls(
  account: Pick<Account, "url" | "siteType" | "checkinPageUrl">,
): string[] {
  const custom = account.checkinPageUrl?.trim();
  if (custom) {
    try {
      return [new URL(custom, account.url).toString()];
    } catch {
      // 非法自定义值退类型默认候选
    }
  }
  const raw = CHECKIN_PAGE_PATHS[account.siteType];
  const paths = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const urls: string[] = [];
  for (const path of paths) {
    try {
      urls.push(new URL(path, account.url).toString());
    } catch {
      // 跳过非法路径，继续下一个候选
    }
  }
  return urls;
}

/** 签到页地址（单个主候选）：自定义/类型首候选，兜底站点首页。"去签到页"按钮与展示用 */
export function resolveCheckinPageUrl(
  account: Pick<Account, "url" | "siteType" | "checkinPageUrl">,
): string {
  return resolveCheckinPageUrls(account)[0] ?? account.url;
}

/** 账号是否有资格参与签到——runner 的 skip 判定与 UI 的按钮显隐共用同一真源 */
export function canCheckin(account: Account): boolean {
  if (account.disabled || !account.checkinEnabled || account.tokenState === "expired") return false;
  // sub2api / other 无签到能力
  if (!CHECKIN_SITE_TYPES.includes(account.siteType)) return false;
  // 仅凭证账号（token 模式未填 token）调不了站点接口，跳过
  return account.authType !== "token" || !!account.accessToken;
}

/** 仅绑定站点身份，不把认证凭据复制进签到记录。 */
export function checkinContext(account: Pick<Account, "url" | "siteType" | "userId">): string {
  return JSON.stringify([account.url, account.siteType, account.userId]);
}

export function currentCheckinRecord(account: Account, record?: AccountCheckinRecord): AccountCheckinRecord | undefined {
  // 老版本记录没有 context，仍承认其成功状态；编辑身份时由 storage 绑定旧身份。
  return record && (!record.context || record.context === checkinContext(account)) ? record : undefined;
}

export function hasUnavailableCheckin(account: Account): boolean {
  const capability = account.checkinCapability;
  return capability?.context === checkinContext(account) && capability.state !== "supported";
}

/** 执行中改凭据或签到页面后，旧请求不能继续提交或回写账号状态。 */
export function sameCheckinAccount(a: Account, b: Account): boolean {
  return checkinContext(a) === checkinContext(b) && a.authType === b.authType &&
    a.accessToken === b.accessToken &&
    a.sessionAuth?.sessionId === b.sessionAuth?.sessionId &&
    a.sessionAuth?.accessExpiresAt === b.sessionAuth?.accessExpiresAt &&
    a.checkinPageUrl === b.checkinPageUrl;
}

export function checkinRetryAt(account: Account, record: AccountCheckinRecord | undefined, cooldowns: Record<string, number>): number {
  const values = [currentCheckinRecord(account, record)?.retryAt, cooldowns[account.url]];
  return Math.max(0, ...values.filter((at): at is number => typeof at === "number" && Number.isFinite(at)));
}

/** 记录是否表示"今天已签"（success 与 already_checked 等价视为已签） */
export function isCheckedToday(
  record: AccountCheckinRecord | undefined,
  today: string,
  account?: Account,
): boolean {
  if (account) record = currentCheckinRecord(account, record);
  return (
    record?.date === today &&
    (record.status === "success" || record.status === "already_checked")
  );
}

export function formatRunSummary(s: RunSummary, opts?: { withSkipped?: boolean }): string {
  let base = `成功 ${s.success} · 已签 ${s.already} · 失败 ${s.failed}`;
  if (s.needsVerify > 0) base += ` · 待验证 ${s.needsVerify}`;
  return opts?.withSkipped ? `${base} · 跳过 ${s.skipped}` : base;
}
