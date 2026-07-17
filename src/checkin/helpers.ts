import type { Account, AccountCheckinRecord, RunSummary } from "@/types";

/** 账号是否有资格参与签到——runner 的 skip 判定与 UI 的按钮显隐共用同一真源 */
export function canCheckin(account: Account): boolean {
  return !account.disabled && account.checkinEnabled && account.tokenState !== "expired";
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
