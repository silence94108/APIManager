import { ApiError, VerificationRequiredError } from "@/api/transport";
import type { ProviderResult } from "@/types";

const ALREADY_CHECKED_PATTERNS = ["今天已经签到", "已经签到", "已签到", "already"];

export function isAlreadyCheckedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return ALREADY_CHECKED_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/** new-api 系 {success, message} 响应 → 统一结果。解析规则的唯一出处，新增分叉站点 provider 直接复用 */
export function resultFromSuccessMessage(
  success: boolean | undefined,
  message: string,
): ProviderResult {
  if (success) return { status: "success", message };
  if (isAlreadyCheckedMessage(message)) return { status: "already_checked", message };
  return { status: "failed", message: message || "签到失败（站点未返回原因）" };
}

/** 异常 → 统一 failed 结果；CF 人机验证归"待验证"，404 归一为"站点不支持" */
export function failedFromError(e: unknown): ProviderResult {
  // 注意判序：VerificationRequiredError 是 ApiError 子类，必须先判
  if (e instanceof VerificationRequiredError) {
    return { status: "needs_verification", message: e.message };
  }
  if (e instanceof ApiError) {
    if (e.status === 404) {
      return { status: "failed", message: "站点不支持签到接口（404）" };
    }
    return { status: "failed", message: e.message };
  }
  return { status: "failed", message: e instanceof Error ? e.message : String(e) };
}
