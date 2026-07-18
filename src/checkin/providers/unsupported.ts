import type { Account, ProviderResult } from "@/types";
import type { CheckinProvider } from "../types";

/**
 * 无签到能力的站点占位 provider（sub2api 无内置签到、other 为通用记录型）。
 * 这类账号已被 canCheckin 提前挡下、不会进入执行；此实现仅为满足 SiteType→provider 的完备映射，
 * 万一被直接调用也返回明确的 failed 而非抛错。
 */
export const unsupportedCheckinProvider: CheckinProvider = {
  async checkIn(_account: Account): Promise<ProviderResult> {
    return { status: "failed", message: "该站点类型不支持签到" };
  },
};
