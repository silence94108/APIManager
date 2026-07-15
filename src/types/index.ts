/** 站点类型：内部统一小写；导入 all-api-hub 备份时映射其原始枚举（含大写 "Veloera"） */
export const SITE_TYPES = ["new-api", "veloera", "voapi-v2", "anyrouter"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const SITE_TYPE_LABELS: Record<SiteType, string> = {
  "new-api": "New API",
  veloera: "Veloera",
  "voapi-v2": "VoAPI v2",
  anyrouter: "AnyRouter",
};

/** anyrouter 固定 cookie（复用浏览器登录态），其余默认 token */
export type AuthType = "token" | "cookie";

export interface Account {
  id: string;
  name: string;
  /** 规范化 origin，如 https://api.example.com */
  url: string;
  siteType: SiteType;
  authType: AuthType;
  /** 站点内用户 id——兼容请求头的值 */
  userId: string;
  /** Bearer token / voapi raw JWT；cookie 模式可空 */
  accessToken?: string;
  /** 预留：导入 all-api-hub cookieAuth.sessionCookie 时保存，当前不用于请求 */
  sessionCookie?: string;
  username?: string;
  groupId: string | null;
  tagIds: string[];
  notes?: string;
  /** 禁用后不参与刷新/签到 */
  disabled: boolean;
  /** 该账号是否参与（自动+批量）签到 */
  checkinEnabled: boolean;
  /** voapi-v2 JWT 过期标记；expired 的账号签到时跳过 */
  tokenState?: "ok" | "expired";
  balance?: { usd: number; updatedAt: number };
  createdAt: number;
  updatedAt: number;
}

export interface Group {
  id: string;
  name: string;
  sortOrder: number;
  /** popup 折叠态直接持久化在组上 */
  collapsed: boolean;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: number;
}

export type CheckinStatus = "success" | "already_checked" | "failed";

export interface ProviderResult {
  status: CheckinStatus;
  message?: string;
}

export interface AccountCheckinRecord {
  /** 本地 YYYY-MM-DD——判"今日已签"的唯一依据 */
  date: string;
  status: CheckinStatus;
  message?: string;
  at: number;
}

export type RunKind = "daily" | "manual" | "retry";

export interface RunSummary {
  success: number;
  already: number;
  failed: number;
  skipped: number;
}

export interface RunOutcome {
  summary: RunSummary;
  /** 本轮 failed 的账号 id（重试调度的输入） */
  failedIds: string[];
}

export interface CheckinSettings {
  autoEnabled: boolean;
  /** "HH:mm"，要求 windowStart < windowEnd（同日窗口） */
  windowStart: string;
  windowEnd: string;
  retryEnabled: boolean;
  notifyOnFinish: boolean;
}

export interface SchedulerState {
  /** 本地 YYYY-MM-DD，保证每日至多一跑 */
  lastDailyRunDay?: string;
  /** 闹钟目标日，触发时不匹配今天则丢弃重排（防休眠后陈旧闹钟） */
  dailyAlarmTargetDay?: string;
  nextDailyAt?: number;
  nextRetryAt?: number;
  retry?: {
    day: string;
    pendingIds: string[];
    attempts: Record<string, number>;
  };
  lastRun?: {
    at: number;
    kind: RunKind;
    summary: RunSummary;
  };
}

export type CheckinResults = Record<string, AccountCheckinRecord>;
