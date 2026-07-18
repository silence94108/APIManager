import { ApiError, VerificationRequiredError } from "@/api/transport";
import type { ProviderResult } from "@/types";

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
  if (success) return { status: "success", message };
  if (isAlreadyCheckedMessage(message)) return { status: "already_checked", message };
  if (isVerificationRequiredMessage(message)) return { status: "needs_verification", message };
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
