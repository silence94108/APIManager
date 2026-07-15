import { siteFetch } from "@/api/transport";
import type { Account, ProviderResult } from "@/types";
import type { CheckinProvider } from "../types";
import { failedFromError, resultFromSuccessMessage } from "./shared";

interface CheckinResponse {
  success?: boolean;
  message?: string;
}

export const newApiProvider: CheckinProvider = {
  async checkIn(account: Account): Promise<ProviderResult> {
    try {
      const res = await siteFetch<CheckinResponse>(account, "/api/user/checkin", {
        method: "POST",
        body: "{}",
      });
      return resultFromSuccessMessage(res.success, res.message ?? "");
    } catch (e) {
      return failedFromError(e);
    }
  },
};
