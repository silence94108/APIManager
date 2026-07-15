import type { SchedulerState } from "@/types";
import { schedulerStateItem } from "./items";

export async function patchSchedulerState(
  patch: Partial<SchedulerState>,
): Promise<SchedulerState> {
  const state = await schedulerStateItem.getValue();
  const next = { ...state, ...patch };
  await schedulerStateItem.setValue(next);
  return next;
}
