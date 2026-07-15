import type { CheckinSettings } from "@/types";
import { checkinSettingsItem } from "./items";

export function getCheckinSettings(): Promise<CheckinSettings> {
  return checkinSettingsItem.getValue();
}

export function setCheckinSettings(settings: CheckinSettings): Promise<void> {
  return checkinSettingsItem.setValue(settings);
}
