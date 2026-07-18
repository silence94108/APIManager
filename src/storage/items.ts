import { storage } from "wxt/utils/storage";
import type {
  Account,
  CheckinResults,
  CheckinSettings,
  Group,
  SchedulerState,
  Tag,
  VaultMeta,
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

export const vaultMetaItem = storage.defineItem<VaultMeta | null>("local:vaultMeta", {
  fallback: null,
});

/** 解锁后的 AES 密钥（raw base64）——只放 session 区，浏览器关闭即清空，永不落盘 */
export const vaultKeyItem = storage.defineItem<string | null>("session:vaultKey", {
  fallback: null,
});
