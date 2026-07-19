/** 站点类型：内部统一小写；导入 all-api-hub 备份时映射其原始枚举（含大写 "Veloera"） */
export const SITE_TYPES = ["new-api", "veloera", "voapi-v2", "anyrouter", "sub2api", "other"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const SITE_TYPE_LABELS: Record<SiteType, string> = {
  "new-api": "New API",
  veloera: "Veloera",
  "voapi-v2": "VoAPI v2",
  anyrouter: "AnyRouter",
  sub2api: "Sub2API",
  other: "其他",
};

/** 支持签到的站点类型——sub2api 无内置签到，other 为通用记录型，均排除 */
export const CHECKIN_SITE_TYPES: SiteType[] = ["new-api", "veloera", "voapi-v2", "anyrouter"];

/** 支持余额查询的站点类型——other 为纯记录型，不拉余额 */
export const BALANCE_SITE_TYPES: SiteType[] = [
  "new-api",
  "veloera",
  "voapi-v2",
  "anyrouter",
  "sub2api",
];

/** 支持模型可用性测试的站点类型——new-api 系（/api/token 列表 + /v1/chat/completions 形状一致） */
export const MODEL_TEST_SITE_TYPES: SiteType[] = ["new-api", "veloera", "anyrouter"];

/** anyrouter 固定 cookie（复用浏览器登录态），其余默认 token */
export type AuthType = "token" | "cookie";

export const OAUTH_PROVIDERS = ["linuxdo", "github", "other"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  linuxdo: "LinuxDo",
  github: "GitHub",
  other: "其他",
};

/** AES-GCM 密文（字段均 base64） */
export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
}

/** 站点登录凭证：密码经 vault 加密，OAuth 只记录授权信息 */
export type Credential =
  | { kind: "password"; username: string; passwordEnc: EncryptedBlob }
  | { kind: "oauth"; provider: OAuthProvider; identity?: string };

/** vault 元数据——密钥永不落盘，只存盐和用于验证主密码的校验密文 */
export interface VaultMeta {
  salt: string;
  verifier: EncryptedBlob;
  createdAt: number;
}

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
  /** 站点 favicon URL——识别时从页面抽取，仅用于列表展示，读不到则空 */
  faviconUrl?: string;
  /** 站点登录凭证（账密 / OAuth 授权记录）；有凭证时 token 与用户 ID 可缺省（仅记录，不参与余额签到） */
  credential?: Credential;
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
  /** 使用金额统计（USD）：totalUsd=累计已用（new-api 系 used_quota / sub2api quota_used），todayUsd=今日消耗（仅 new-api 系 stat 接口）；站点不支持的口径为 undefined */
  usage?: { totalUsd?: number; todayUsd?: number; updatedAt: number };
  createdAt: number;
  updatedAt: number;
}

export interface Group {
  id: string;
  name: string;
  sortOrder: number;
  /** 折叠态直接持久化在组上——popup 与设置页账号列表共用 */
  collapsed: boolean;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: number;
}

export type CheckinStatus = "success" | "already_checked" | "failed" | "needs_verification";

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
  /** 被站点人机验证挡住、需用户到页面手动完成——不计入 failed，不参与自动重试 */
  needsVerify: number;
}

export interface RunOutcome {
  summary: RunSummary;
  /** 本轮 failed 的账号 id（重试调度的输入） */
  failedIds: string[];
}

export interface CheckinSettings {
  autoEnabled: boolean;
  /** 触发模式：window=窗口内随机时刻（默认，缺省视为 window），fixed=每天固定时刻 */
  mode?: "window" | "fixed";
  /** "HH:mm"，要求 windowStart < windowEnd（同日窗口） */
  windowStart: string;
  windowEnd: string;
  /** "HH:mm"，mode=fixed 时的每日触发时刻；错过（浏览器未开）则打开后尽快补签 */
  fixedTime?: string;
  retryEnabled: boolean;
  /** 遇 Turnstile 待验证时自动开临时窗口走站点前端流程；缺省视为开启 */
  turnstileAssist?: boolean;
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
