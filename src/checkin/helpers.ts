import { CHECKIN_SITE_TYPES, type Account, type AccountCheckinRecord, type RunSummary } from "@/types";

/** 账号是否有资格参与签到——runner 的 skip 判定与 UI 的按钮显隐共用同一真源 */
export function canCheckin(account: Account): boolean {
  if (account.disabled || !account.checkinEnabled || account.tokenState === "expired") return false;
  // sub2api / other 无签到能力
  if (!CHECKIN_SITE_TYPES.includes(account.siteType)) return false;
  // 仅凭证账号（token 模式未填 token）调不了站点接口，跳过
  return account.authType !== "token" || !!account.accessToken;
}

/** 记录是否表示"今天已签"（success 与 already_checked 等价视为已签） */
export function isCheckedToday(
  record: AccountCheckinRecord | undefined,
  today: string,
): boolean {
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
