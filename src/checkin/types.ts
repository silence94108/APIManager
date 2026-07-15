import type { Account, ProviderResult } from "@/types";

export interface CheckinProvider {
  checkIn(account: Account): Promise<ProviderResult>;
}
