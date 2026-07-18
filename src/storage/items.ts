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

/** 模型测试的常用模型预设（用户可增删） */
export const DEFAULT_TEST_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
];

export interface ModelTestSettings {
  /** 待测模型列表 */
  models: string[];
  /** 按 accountId 记忆的手填 API Key（自动拉取失败时用户补的） */
  manualKeys: Record<string, string>;
}

export const modelTestSettingsItem = storage.defineItem<ModelTestSettings>(
  "local:modelTestSettings",
  { fallback: { models: DEFAULT_TEST_MODELS, manualKeys: {} } },
);
