import { siteFetch } from "@/api/transport";
import type { Account, ProviderResult } from "@/types";
import type { CheckinProvider } from "../types";
import { failedFromError, isAlreadyCheckedMessage } from "./shared";

interface CheckinResponse {
  success?: boolean;
  message?: string;
}

interface CheckinStatusResponse {
  data?: { can_check_in?: boolean };
}

export const veloeraProvider: CheckinProvider = {
  async checkIn(account: Account): Promise<ProviderResult> {
    try {
      const res = await siteFetch<CheckinResponse>(account, "/api/user/check_in", {
        method: "POST",
      });
      const message = res.message ?? "";
      if (res.success) return { status: "success", message };
      if (isAlreadyCheckedMessage(message)) return { status: "already_checked", message };
      return { status: "failed", message: message || "签到失败（站点未返回原因）" };
    } catch (e) {
      return failedFromError(e);
    }
  },

  async queryCheckedToday(account: Account): Promise<boolean | undefined> {
    try {
      const res = await siteFetch<CheckinStatusResponse>(account, "/api/user/check_in_status");
      const canCheckIn = res.data?.can_check_in;
      // can_check_in=true 表示今天还能签（即未签）
      return typeof canCheckIn === "boolean" ? !canCheckIn : undefined;
    } catch {
      return undefined;
    }
  },
};
