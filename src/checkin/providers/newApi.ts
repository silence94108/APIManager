import { siteFetch } from "@/api/transport";
import type { Account, ProviderResult } from "@/types";
import type { CheckinProvider } from "../types";
import { executeStatusFirst, invalidCheckinStatus, readCheckinStatus } from "../execution";
import { resultFromSuccessMessage } from "./shared";
import { localDayString } from "@/utils/day";

interface CheckinResponse {
  success?: boolean;
  message?: string;
  data?: { stats?: { checked_in_today?: boolean }; enabled?: boolean };
}

export const newApiProvider: CheckinProvider = {
  async checkIn(account: Account, options): Promise<ProviderResult> {
    const observe = () => readCheckinStatus<CheckinResponse>(account,
      `/api/user/checkin?month=${localDayString().slice(0, 7)}`, (res) => {
        if (res?.success === false) return { blocked: resultFromSuccessMessage(false, res.message ?? "") };
        if (res?.success === true && res.data?.enabled === false) return { blocked: resultFromSuccessMessage(false, "站点未启用签到") };
        const checked = res?.data?.stats?.checked_in_today;
        return res?.success === true && typeof checked === "boolean" ? { checked } : invalidCheckinStatus();
      });
    return executeStatusFirst(observe, async () => {
      const res = await siteFetch<CheckinResponse | null>(account, "/api/user/checkin", {
        method: "POST",
        body: "{}",
      });
      return resultFromSuccessMessage(res?.success, res?.message ?? "");
    }, options, false, account.url + "/api/user/checkin");
  },
};
