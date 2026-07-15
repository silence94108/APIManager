import type { Account, ProviderResult } from "@/types";

export interface CheckinProvider {
  checkIn(account: Account): Promise<ProviderResult>;
  /** 站点有独立状态接口时实现；undefined 表示查不到（不阻塞签到） */
  queryCheckedToday?(account: Account): Promise<boolean | undefined>;
}

export interface RunSummary {
  success: number;
  already: number;
  failed: number;
  skipped: number;
}

export interface RunOutcome {
  summary: RunSummary;
  /** 本轮 failed 的账号 id（重试调度的输入） */
  failedIds: string[];
}
