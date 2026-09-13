import type { Account, ProviderResult } from "@/types";

export interface CheckinProvider {
  checkIn(account: Account, options?: CheckinExecutionOptions): Promise<ProviderResult>;
}

export interface CheckinExecutionOptions {
  reconcileOnly?: boolean;
  /** 发送任何签到写请求前落盘，落盘失败则停止提交。 */
  beforeSubmit?: () => Promise<void>;
}

export type CheckinObservation = { checked: boolean } | { blocked: ProviderResult };
