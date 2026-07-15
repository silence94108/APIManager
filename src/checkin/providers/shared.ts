import { ApiError } from "@/api/transport";
import type { ProviderResult } from "@/types";

const ALREADY_CHECKED_PATTERNS = ["今天已经签到", "已经签到", "已签到", "already"];

export function isAlreadyCheckedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return ALREADY_CHECKED_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/** 异常 → 统一 failed 结果；404 归一为"站点不支持" */
export function failedFromError(e: unknown): ProviderResult {
  if (e instanceof ApiError) {
    if (e.status === 404) {
      return { status: "failed", message: "站点不支持签到接口（404）" };
    }
    return { status: "failed", message: e.message };
  }
  return { status: "failed", message: e instanceof Error ? e.message : String(e) };
}
