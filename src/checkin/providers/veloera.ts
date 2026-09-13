import { siteFetch } from "@/api/transport";
import type { Account, ProviderResult } from "@/types";
import type { CheckinProvider } from "../types";
import { executeStatusFirst, invalidCheckinStatus, readCheckinStatus } from "../execution";
import { resultFromSuccessMessage } from "./shared";

interface CheckinResponse {
  success?: boolean;
  message?: string;
  data?: { can_check_in?: boolean; enabled?: boolean };
}

export const veloeraProvider: CheckinProvider = {
  async checkIn(account: Account, options): Promise<ProviderResult> {
    const observe = () => readCheckinStatus<CheckinResponse>(account, "/api/user/check_in_status", (res) => {
      if (res?.success === false) return { blocked: resultFromSuccessMessage(false, res.message ?? "") };
      if (res?.success === true && res.data?.enabled === false) return { blocked: resultFromSuccessMessage(false, "站点未启用签到") };
      const allowed = res?.data?.can_check_in;
      return res?.success === true && typeof allowed === "boolean" ? { checked: !allowed } : invalidCheckinStatus();
    });
    return executeStatusFirst(observe, async () => {
      const res = await siteFetch<CheckinResponse | null>(account, "/api/user/check_in", {
        method: "POST",
      });
      return resultFromSuccessMessage(res?.success, res?.message ?? "");
    }, options, false, account.url + "/api/user/check_in");
  },
};
