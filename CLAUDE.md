# APIManager 项目规范

精简版 AI 中转站账号管理浏览器扩展：**账号管理（分组 + 标签）**、**余额查看**、**每日自动签到**。功能与数据安全细节见 `README.md`，本文件讲**架构与约定**——动代码前先读这里，别违反下面的边界。

## 技术栈

- **WXT 0.20**（MV3 扩展框架）：`browser`、`defineBackground` 等由 wxt 自动注入为全局，**不要**手动 import polyfill；`storage` 从 `wxt/utils/storage` 导入。
- **React 19** + **Tailwind CSS 4**（`@theme` 声明 token，见 `src/styles/global.css`）。
- **TypeScript**（`strict`）；**@webext-core/messaging**（类型化 RPC）；**lucide-react**（图标，见下文规范）。
- 测试用 **Vitest**。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 拉起 Chrome 热更新调试（`dev:firefox` 走 Firefox） |
| `npm run compile` | `tsc --noEmit` 类型检查 |
| `npm test` | Vitest 单测（`--run` 一次性） |
| `npm run build` / `zip` | 产出 `.output/chrome-mv3` / 打包 |

改动任意 `.ts/.tsx` **必跑** `npm run compile`；动到有单测的纯逻辑模块 **必跑** `npm test`（见「测试约定」）。

## 架构分层（改代码前先定位到层）

- `entrypoints/background.ts` — 后台 service worker：**唯一**的 `onMessage` 处理端 + `alarms` 调度入口。UI 干不了的活（发请求、签到、调度）都在这。
- `entrypoints/popup/` `entrypoints/options/` — 两套 React UI；options 用 hash 伪路由切页（`options/App.tsx:27`，支持 `options.html#checkin` 锚点直达）。
- `messaging/protocol.ts` — UI → background 的 RPC 契约（`ProtocolMap`）。
- `storage/items.ts` — **所有**持久化 item 的唯一定义处。
- `checkin/` — `providers/`（按站点类型的签到实现）+ `runner.ts`（跑一轮，产出 `RunOutcome` 并写 `checkinResults`）+ `scheduler.ts`（闹钟：每日窗口/固定时刻、失败重试）。
- `api/transport.ts` — **所有**站点请求的唯一出口 `siteFetch` + 错误类型；`balance.ts` / `modelTest.ts` 建在其上。
- `vault/` — 主密码加密（PBKDF2 310k + AES-GCM）。
- `detect/` — 识别当前标签页的中转站账号。
- `importExport/` — all-api-hub 导入（`fromAllApiHub`）+ 自身备份（`ownBackup`）。
- `types/index.ts` — 类型定义 + **站点能力常量中枢**（见下）。
- `ui/` — popup 与 options **共用**的组件/hooks（`components.tsx`、`hooks.ts`、`AccountFormDialog.tsx` 等）；跨两端的 UI 先来这找，别各写一份。

## 核心约定

### 站点类型 `SiteType` 是能力中枢
新增站点类型、或调整某类型的能力，**必须同步** `types/index.ts` 里的 `SITE_TYPES` + `SITE_TYPE_LABELS` + `CHECKIN_SITE_TYPES` / `BALANCE_SITE_TYPES` / `MODEL_TEST_SITE_TYPES`，以及 `checkin/providers/index.ts` 的注册表。注册表是 `Record<SiteType, CheckinProvider>`——缺 key 会**编译报错**，这是有意的防漏网。判断「能不能签 / 能不能查余额」用 `canCheckin(account)`（`checkin/helpers.ts`）/ `BALANCE_SITE_TYPES.includes(...)`，**别散写** `siteType === "xxx"`。

### storage：单一出处 + 响应式订阅
- 所有 item 在 `storage/items.ts` 用 `storage.defineItem` 定义，别处不再 `defineItem`。
- key 前缀语义：`local:` 持久化，`session:` 浏览器关闭即清（`vaultKey` 靠这个**永不落盘**）。
- UI 读 storage 一律用 `useStorageItem(xxxItem)`（`ui/hooks.ts`）——内部 `getValue` + `watch` 自动重渲染，**别手写订阅、别只 `getValue` 一次**。（教训：设置页曾漏订阅 `checkinResultsItem`，签到成功后状态点不刷新。）

### messaging：UI 不直接干后台活
UI 需要后台能力 → 在 `protocol.ts` 的 `ProtocolMap` 加签名 → `background.ts` 里 `onMessage` 实现。错误**一律走返回值** `{ ok: false, error }`，不 `throw` 跨端（Error 跨 context 序列化不可靠）。

### 签到 provider 插件化
新增站点签到：
1. 建 `checkin/providers/xxx.ts`，实现 `CheckinProvider`（`checkIn(account) => Promise<ProviderResult>`）。
2. 请求走 `siteFetch`；结果用 `providers/shared.ts` 的 `resultFromSuccessMessage`（`{success,message}` 类站点）/ `failedFromError` 归一，**别自己拼 `status`**。
3. 在 `providers/index.ts` 注册进 `Record<SiteType, CheckinProvider>`。

范例见 `providers/newApi.ts`（十几行）。四态 `CheckinStatus`：`success` / `already_checked` / `failed` / `needs_verification`。**`needs_verification`（人机验证）不算失败、不参与自动重试**——只能引导用户到站点页面手动完成。

### 站点请求统一走 `siteFetch`
`api/transport.ts:siteFetch` 是唯一出口：统一拼头（`compatHeaders`）、认证（token → `Bearer`；voapi-v2 用 `rawToken` 不加前缀；cookie 模式 `credentials: "include"`）、错误归一。非 2xx / 非 JSON → `ApiError`；Cloudflare 挑战 → `VerificationRequiredError`（是 `ApiError` 子类，`instanceof` 判序**必须先判子类**）。**别在 provider / balance 里裸 `fetch`**。

### vault：secret 不落明文
密码、站点 API Key、模型测试手填 key 一律 `encryptSecret` → `EncryptedBlob` 存储，读时 `decryptSecret`；密钥只在 `session:vaultKey`。锁定态调用抛 `VaultLockedError`——UI 侧用 `useVaultGate()`（`ui/hooks.ts`）门控（锁着先弹解锁再续跑）。改动涉及 secret 时要顾及三条链路：改密（`changeVaultPassword` 全量重加密）、重置（`resetVault` 清空）、异库合并（脏密文剥离）。

### 「今日」口径
「今日已签」的唯一依据是 `localDayString()`（本地 `YYYY-MM-DD`，`utils/day.ts`）比对 `record.date`。凡涉及「今天」的判断都用它，**别拿 `Date` 直接比时间戳**（跨天、时区会错）。

## 设计系统：Phosphor Console

- token 在 `global.css` 的 `@theme`，语义：`phos`=活着/已签/有钱、`amber`=过期警示、`signal`=失败、`ink`/`ink-mute`/`ink-faint`=文字层级、`carbon`/`panel`/`raised`=底层。**深色为主，浅色是同套 token 的 `@media` 变体**——用语义 class（`text-phos`、`bg-raised`…），别硬编码 hex。
- 数字读数（余额/统计/时间）挂 `.readout`（等宽 `tabular-nums`）。
- 账号状态点四态由 `dotStatus()` 统一推导、`StatusDot` 渲染（`ui/components.tsx`），popup 与 options **共用同一函数**，改推导逻辑两端同时生效。

## UI 图标：一律用 lucide-react，禁止 emoji / Unicode 图形字符

- 所有充当图标的视觉元素必须用 `lucide-react` 组件（继承 `currentColor`，`size` 取 11–14 与相邻文字字号匹配），**禁止**用 emoji（🔑 ✋ ⚡ ⚠ ⚙）或 Unicode 图形字符（↗ ▶ ✓ ✗ ◔ ▦ ↑ ↓）当图标。
- 原因：emoji 在 Windows/不同平台渲染成彩色位图，与 Phosphor Console 深色终端风冲突且颜色不可控；Unicode 符号跨平台字形不一致。SVG 图标单色跟随文字颜色，渲染一致。
- 文案中的箭头（如「设置 → 安全」、注释里的 `→`）是文字表达，不受此限。
- 图标与文字混排放在 `Button` 内即可（Button 基类已带 `inline-flex items-center gap-1`）；放非 flex 容器时外包 `inline-flex items-center gap-1` 的 span。
- 折叠箭头统一 `ChevronRight` + `rotate-90`（展开态）过渡，参考 `GroupSection.tsx`。
- 新增图标先查 lucide 里语义贴合的名字，与既有映射保持一致：签到 `Zap`、刷新 `RefreshCw`、密钥 `KeyRound`、编辑 `Pencil`、手动 `Hand`、外链 `ArrowUpRight`、重试 `RotateCcw`、警告/待验证 `TriangleAlert`、删除/关闭 `X`、成功 `Check`。

## 测试约定

- Vitest，`__tests__` 就近放（如 `checkin/__tests__/`）。
- 纯逻辑模块有单测覆盖：`storage`、`vault`、`checkin`（helpers / scheduler / shared）、`importExport`、`utils`、`api/modelTest`。改这些**务必补测并 `npm test`**。
- UI 组件无单测，靠 `npm run dev` 手验 + `npm run compile` 兜类型。

## 提交

- 中文 commit，格式随 `git log` 既有风格（`类型：一句话——补充细节与动机`），不引入 conventional commits。
- commit / PR 里**禁止**任何 AI 署名或水印。
