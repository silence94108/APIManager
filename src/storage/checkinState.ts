import type { AccountCheckinRecord, CheckinResults, SchedulerState } from "@/types";
import { checkinResultsItem, schedulerStateItem } from "./items";

export function getCheckinResults(): Promise<CheckinResults> {
  return checkinResultsItem.getValue();
}

export async function setAccountCheckinRecord(
  accountId: string,
  record: AccountCheckinRecord,
): Promise<void> {
  const results = await checkinResultsItem.getValue();
  await checkinResultsItem.setValue({ ...results, [accountId]: record });
}

export function getSchedulerState(): Promise<SchedulerState> {
  return schedulerStateItem.getValue();
}

export async function patchSchedulerState(
  patch: Partial<SchedulerState>,
): Promise<SchedulerState> {
  const state = await schedulerStateItem.getValue();
  const next = { ...state, ...patch };
  await schedulerStateItem.setValue(next);
  return next;
}
