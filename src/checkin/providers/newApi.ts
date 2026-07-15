import { siteFetch } from "@/api/transport";
import type { Account, ProviderResult } from "@/types";
import { localMonthString } from "@/utils/day";
import type { CheckinProvider } from "../types";
import { failedFromError, isAlreadyCheckedMessage } from "./shared";

interface CheckinResponse {
  success?: boolean;
  message?: string;
}

interface CheckinStatsResponse {
  data?: { stats?: { checked_in_today?: boolean } };
}

export const newApiProvider: CheckinProvider = {
  async checkIn(account: Account): Promise<ProviderResult> {
    try {
      const res = await siteFetch<CheckinResponse>(account, "/api/user/checkin", {
        method: "POST",
        body: "{}",
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
      const res = await siteFetch<CheckinStatsResponse>(
        account,
        `/api/user/checkin?month=${localMonthString()}`,
      );
      const checked = res.data?.stats?.checked_in_today;
      return typeof checked === "boolean" ? checked : undefined;
    } catch {
      return undefined;
    }
  },
};
