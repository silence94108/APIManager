import { ApiError, VerificationRequiredError } from "@/api/transport";
import type { CheckinFailureReason, ProviderResult } from "@/types";

export function checkinFailure(reason: CheckinFailureReason, message: string, retryable = false): ProviderResult {
  return { status: "failed", reason, message, retryable };
}

export function uncertainCheckin(message = "签到提交结果尚未确认，已暂停自动重试；请到站点核对"): ProviderResult {
  return { ...checkinFailure("uncertain", message), uncertain: true };
}

const ALREADY_CHECKED_PATTERNS = ["今天已经签到", "已经签到", "已签到", "already"];

export function isAlreadyCheckedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return ALREADY_CHECKED_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/**
 * 站点在签到接口开了人机验证（Turnstile / hCaptcha / reCAPTCHA），后台请求缺验证 token 被业务层拒。
 * 这类 message 命中——归"待验证"而非"失败"：重试也补不出 token，只能由用户到站点页面手动签。
 */
const VERIFICATION_REQUIRED_PATTERNS = [
  "turnstile",
  "captcha",
  "人机验证",
  "人机校验",
  "验证码",
  "verification",
];

export function isVerificationRequiredMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return VERIFICATION_REQUIRED_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/** new-api 系 {success, message} 响应 → 统一结果。解析规则的唯一出处，新增分叉站点 provider 直接复用 */
export function resultFromSuccessMessage(
  success: boolean | undefined,
  message: string,
): ProviderResult {
  message = typeof message === "string" ? message : "";
  if (success === true) return { status: "success", message };
  if (isAlreadyCheckedMessage(message)) return { status: "already_checked", message };
  if (isVerificationRequiredMessage(message)) return { status: "needs_verification", message };
  if (/不支持.*签到|签到.*不支持|check.?in.*(?:unsupported|not supported)|(?:unsupported|not supported).*check.?in/i.test(message)) {
    return { ...checkinFailure("unsupported", message), capability: "unsupported" };
  }
  if (/未(?:开启|启用).*签到|签到.*(?:关闭|禁用|未开启|未启用)|check.?in.*(?:disabled|not enabled)|disabled.*check.?in/i.test(message)) {
    return { ...checkinFailure("disabled", message), capability: "disabled" };
  }
  if (/未登录|登录.*(?:失效|过期)|请.*登录|unauthoriz|authentication|token.*(?:invalid|expired)|(?:invalid|expired).*token|auth.*expire|jwt.*expire/i.test(message)) {
    return checkinFailure("authentication", message);
  }
  if (/无权|权限不足|forbidden|permission denied/i.test(message)) return checkinFailure("permission", message);
  return checkinFailure(typeof success !== "boolean" ? "invalid_response" : "rejected",
    message || (success === false ? "签到失败（站点未返回原因）" : "签到失败（站点未返回有效状态）"));
}

/** 只读请求的临时失败可重试；写请求的网络/服务端异常需先复核是否已提交。 */
export function failedFromError(e: unknown, phase: "read" | "submit" = "submit"): ProviderResult {
  // 注意判序：VerificationRequiredError 是 ApiError 子类，必须先判
  if (e instanceof VerificationRequiredError) {
    return { status: "needs_verification", message: e.message, retryable: false };
  }
  if (e instanceof ApiError) {
    if (e.status === 429) return { ...checkinFailure("rate_limited", e.message, true), retryAt: e.retryAfterAt ?? Date.now() + 60_000 };
    if (e.status === 401 || e.code?.startsWith("AUTH_SESSION")) return checkinFailure("authentication", e.message);
    if (e.status === 403 || e.code === "REQUEST_ORIGIN_NOT_ALLOWED") return checkinFailure("permission", e.message);
    if (e.status === 0 || e.status === 408 || e.status >= 500) {
      if (phase === "submit") return uncertainCheckin();
      const reason = e.code === "REQUEST_TIMEOUT" || /超时/.test(e.message) ? "timeout" : e.status >= 500 ? "server" : "network";
      return checkinFailure(reason, e.message, true);
    }
    if (e.code === "NON_JSON_RESPONSE" || e.code === "INVALID_JSON" || (e.status >= 200 && e.status < 300)) {
      return phase === "submit" ? uncertainCheckin() : checkinFailure("invalid_response", e.message);
    }
    if (e.status === 404 || e.status === 405) return checkinFailure("unsupported", `站点不支持此签到接口（${e.status}），可手动重新检测`);
    return checkinFailure("rejected", e.message);
  }
  return phase === "submit" ? uncertainCheckin() : checkinFailure("invalid_response", e instanceof Error ? e.message : String(e));
}
