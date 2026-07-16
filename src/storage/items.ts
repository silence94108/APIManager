import { storage } from "wxt/utils/storage";
import type { DetectedAccount } from "@/detect/types";
import type {
  Account,
  CheckinResults,
  CheckinSettings,
  Group,
  SchedulerState,
  Tag,
} from "@/types";

export const DEFAULT_CHECKIN_SETTINGS: CheckinSettings = {
  autoEnabled: true,
  windowStart: "09:00",
  windowEnd: "21:00",
  retryEnabled: true,
  notifyOnFinish: true,
};

export const accountsItem = storage.defineItem<Account[]>("local:accounts", {
  fallback: [],
});

export const groupsItem = storage.defineItem<Group[]>("local:groups", {
  fallback: [],
});

export const tagsItem = storage.defineItem<Tag[]>("local:tags", {
  fallback: [],
});

export const checkinSettingsItem = storage.defineItem<CheckinSettings>(
  "local:checkinSettings",
  { fallback: DEFAULT_CHECKIN_SETTINGS },
);

export const schedulerStateItem = storage.defineItem<SchedulerState>(
  "local:schedulerState",
  { fallback: {} },
);

export const checkinResultsItem = storage.defineItem<CheckinResults>(
  "local:checkinResults",
  { fallback: {} },
);

/** popup 识别当前站点后暂存草稿，options 页读取后预填「添加账号」表单并清空 */
export const pendingDetectedItem = storage.defineItem<DetectedAccount | null>(
  "local:pendingDetected",
  { fallback: null },
);
