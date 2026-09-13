# all-api-hub 调研参考（协议事实库）

> 本文档是对 [all-api-hub](https://github.com/qixing-jk/all-api-hub)（AGPL-3.0）源码调研的**事实性协议信息**汇总——接口端点、请求头、响应语义、备份格式。本项目所有代码为独立重写，仅采信这些事实，不搬运其实现。
> 调研基准：all-api-hub v3.52.0（2026-07-15，本地 clone 于 `D:\Desktop\www\all-api-hub`）。

## 签到接口表

| 站点类型 | 签到 | 今日状态查询 | 鉴权 |
|---|---|---|---|
| new-api | `POST /api/user/checkin`，body `"{}"` | `GET /api/user/checkin?month=YYYY-MM` → `data.stats.checked_in_today` | `Authorization: Bearer <token>`；404/405 须确认来自签到接口且为有效响应，500 不代表不支持 |
| veloera | `POST /api/user/check_in`（无 body） | `GET /api/user/check_in_status` → `data.can_check_in`（true=今天还能签） | Bearer |
| anyrouter | `POST /api/user/sign_in`，body `"{}"`，加头 `X-Requested-With: XMLHttpRequest` | 无独立接口，靠签到响应判断 | **强制 Cookie**：`credentials:"include"` 复用浏览器登录态；**空 message = 已签** |
| voapi-v2 | `POST /api/check_in`（无 body），提交后再 GET stats 确认 | `GET /api/check_in/stats` → `data.todaySigned` | **raw JWT（无 Bearer 前缀）**，会过期 |

voapi-v2 响应信封 `{code, data, msg}`：

- `code 0` = 成功
- `code 1` + msg 匹配 `/signed|check/i` = 已签到
- `code 2` + msg 匹配 `/auth\s*expire|unauthorized|token|jwt|login/i` = JWT 过期（→ 标记账号 expired）

anyrouter 响应 `{code, ret, success, message}`：`success:false` 优先按失败/已签/待验证文案分类；成功响应的 message 含 `success`/`签到成功`=成功；显式空 message 或命中已签词表=已签，缺失整个响应状态不能当成已签。

**"已签到" message 词表**（忽略大小写）：`今天已经签到` / `已经签到` / `已签到` / `already`。

## 余额接口

| 站点类型 | 接口 | 换算 |
|---|---|---|
| new-api / veloera / anyrouter | `GET /api/user/self` → `data.quota` | **USD = quota / 500000** |
| voapi-v2 | `GET /api/user/info` → `basicBalance + bindBalance` | 已是美元（可能是字符串） |

## 使用金额接口

- **累计已用**：new-api 系 `/api/user/self` 响应顺带 `data.used_quota`（quota 单位，÷500000）；sub2api `/api/v1/auth/me` 顺带 `data.quota_used`（已是美元）；voapi-v2 账号级无此字段（仅 token 级 `used`，未采用）
- **今日消耗**（仅 new-api 系）：`GET /api/log/self/stat?p=1&page_size=10&token_name=&model_name=&start_timestamp=<本地0点秒>&end_timestamp=<本地23:59:59秒>&type=2` → `data.quota`（÷500000）；type=2 是消费日志（LogType.Consume）

## Turnstile 辅助签到（页面事实）

新版 new-api 在 `POST /api/user/checkin` 业务层要求 Turnstile token（"Turnstile token 为空"），只能由真实页面里的组件产出。原版方案：临时窗口加载签到页 → 点站点自己的签到按钮 → 站点前端带 token 完成请求 → 服务端复核。

- **签到页路径**：new-api / veloera 默认主题 `/console/personal`（部分主题 `/profile`）；anyrouter `/console/topup`；voapi-v2 `/checkIn?_userMenuKey=checkIn`
- **按钮定位**：候选 `button, a, [role="button"]`，文案匹配 `(签到|check\s*in|checkin)`（忽略大小写）、排除 `(已签到|already)`
- **本项目复核语义（2026-09-13 更新）**：点击前核验页面登录身份并保存待确认记录；点击后只调用今日状态查询。已点击但未确认时停止，不重发签到 API、不尝试其他页面。无按钮时才继续下一候选；跨域自定义地址仅供用户手动打开。

## 通用请求头

- `Content-Type: application/json`
- userId 兼容头扇出（各分叉后端认不同的头，全部带上）：`New-API-User`、`Veloera-User`、`voapi-user`、`User-id`，值 = 站点用户 id
- token 模式 `credentials:"omit"`；cookie 模式 `credentials:"include"`
- 响应 content-type 非 JSON（返回登录页 HTML）→ 视为未登录/被 Cloudflare 拦截

## 新版 New API 会话认证（2026-09-13 补充）

以下事实来自用户提供的 `https://api.abnt.it/static/js/index.7e5f802291.js` 公开前端认证模块，仅记录协议，不复用站点实现：

- 用户与短期访问令牌保存在前端内存，不再依赖 `localStorage.user`；可读 Cookie `new_api_has_session` 仅表示可能存在登录会话。
- `POST /api/user/auth/refresh`，携带浏览器 Cookie、无请求体；成功响应为 `{ success: true, data: { access_token, token_type: "Bearer", access_expires_at, user: { id, username }, session: { sid, current } } }`。到期时间为 Unix 秒，刷新 Cookie 为 HttpOnly。
- 后续 `/api/user/self` 等业务接口要求 `Authorization: Bearer <access_token>`，仅带 Cookie 会返回 401。
- 已关联账号的刷新请求携带 `X-Auth-Session: <sid>`，并校验返回的用户 ID 和会话 ID，防止浏览器切换账号后混用凭据。
- 站点用同源 Web Lock `new-api:auth-refresh` 协调续期。409 `AUTH_REFRESH_RACE` 可短暂重试；401 或 `AUTH_SESSION_MISMATCH` 要重新登录/识别，扩展不能放弃原会话约束并自动改用其他账号。
- 扩展以 `Account.sessionAuth` 保存会话 ID 和令牌到期时间，续期令牌只缓存在当前扩展运行环境中；旧版长期 Token 不进入该刷新流程。

2026-09-13 对照上游 v3.61.0 的[当前浏览器身份核验修复](https://github.com/qixing-jk/all-api-hub/pull/1412)：缓存仅作为线索，旧版 Cookie 身份通过 `/api/user/self` 核验，VoAPI 页面 JWT 通过 `/api/user/info` 核验；缓存或补取的 Token 要与已确认用户匹配。识别中登录态或页面变化、请求超时、身份不明时丢弃结果；未核验的新 Token 不覆盖已有凭据。此处仅补充账号识别结论，全文其他协议的调研基准仍为开头所列版本。

用户实测补充：Aether API（`https://api.abnt.it/`）在后台请求中返回 `request origin is not allowed`，账号识别的同源请求正常。扩展对这种来源拒绝和明确的验证拦截增加一次同源标签页请求回退，只读请求遇 HTML 也可回退；提交请求的普通 HTML 响应及页面回退超时均保留不确定性，交由签到流程只读复核。续期仍使用 `X-Auth-Session` 和 `new-api:auth-refresh` 锁，并校验返回的用户 ID 与会话 ID。Cookie 请求在页面内先通过账号接口核对用户，页面跳转到其他来源时停止。

旧版 AnyRouter 的进一步实测：用户刷新控制台页面即可签到。该类型改为直接用同源页面请求，旧账号残留的 Bearer Token 不随 Cookie 发送；签到时临时加载签到页触发前端自动流程，随后请求 `/api/user/sign_in` 确认，不再查找签到按钮。优先使用账号的自定义同源签到地址，默认 `/console/topup`；不会刷新用户原有标签页。

所有后台 API 请求连同响应体解析都有超时（普通请求 15 秒，会话续期 8 秒），页面操作另有后台侧 30 秒总时限，防止页面暂停后 Promise 一直未返回。今日用量是可选统计，限时 5 秒，不因该接口无响应而无限等待余额或签到结果。

## 调度语义（chrome.alarms）

2026-09-13 对照上游 v3.61.0 的[签到能力与安全重试改进](https://github.com/qixing-jk/all-api-hub/pull/1402)，本项目独立实现以下策略。此次只补充账号识别、签到能力和重试结论，备份格式与其他站点协议仍以文首调研基准为准。

- 双闹钟：每日 `checkin:daily` + 重试 `checkin:retry`
- 每日窗口内**均匀随机取时刻**；`lastDailyRunDay`（本地 YYYY-MM-DD）保证每日至多一跑；`dailyAlarmTargetDay` 防休眠后陈旧闹钟误触发
- `onInstalled` / `onStartup` 都要重排闹钟（Chrome 重启会清 alarms）
- MV3 下重试等待必须用 alarm，不能 setTimeout（service worker 会被杀）
- New API / Veloera / VoAPI 先查后签，要求成功信封及布尔型今日状态；已签不 POST，缺失状态或查询失败不盲签。VoAPI 提交成功后仍须查询确认
- 明确不支持或禁用签到的能力证据绑定站点、类型和用户并持久化，自动任务跳过，手动操作允许重新检测，不修改用户签到开关；认证刷新/身份接口失败、普通 HTML、500 均不能据此关闭签到能力
- 只读阶段网络、超时、5xx 等临时故障，以及明确的 429 拒绝可有限重试；至少间隔 30 分钟，首轮后最多两次。认证、权限、验证、无效状态、业务拒绝与存储失败不自动重试
- `Retry-After` 支持秒数和 HTTP 日期；每账号保存最早执行时刻，限流按来源共享。一轮只运行到期账号，其他账号继续等待；重试不跨日，但跨日仍须遵守未到期的站点限流
- 签到写请求/页面自动签到开始前先落盘待确认记录。写请求网络错误、超时、5xx 或无效响应只做一次只读复核；仍未确认则当日只读，扩展重启与手动操作也不能重复提交
- 签到结果绑定账号身份，编辑站点/用户后旧记录不作为新身份的成功；兼容旧版无 context 的成功记录，但不把旧失败默认加入重试

## all-api-hub 备份 JSON 格式（导入功能的输入契约）

```
BackupFullV2 = {
  version: "2.0", timestamp,
  accounts: {
    accounts: SiteAccount[],        // ★ 账号数组
    bookmarks, pinnedAccountIds, orderedAccountIds, last_updated
  },
  tagStore?: { version: 1, tagsById: Record<id, {id, name, createdAt, updatedAt}> },
  preferences, channelConfigs, apiCredentialProfiles?
}
// 仅账号导出变体：{ version, timestamp, type: "accounts", accounts, tagStore? }
```

SiteAccount → 本项目 Account 映射：

- `site_name`→name；`site_url`→normalizeOrigin(url)；`site_type`→siteType
  - **site_type 精确匹配**（注意大小写）：`"new-api"` / `"Veloera"`（大写 V）/ `"voapi-v2"` / `"anyrouter"`；其余类型（one-api、one-hub、done-hub 等）跳过并计入报告
- `account_info.id`→String → userId；`account_info.access_token`→accessToken；`account_info.username`→username
- `authType`：`"access_token"`→token、`"cookie"`→cookie、缺省→token；`cookieAuth.sessionCookie`→sessionCookie（仅保存备用）
- `checkIn.enableDetection && autoCheckInEnabled !== false`→checkinEnabled
- `notes` / `disabled` 直传（布尔缺省补 false）
- 标签：有 `tagStore` 整体导入（保 id，`tagIds` 直接沿用）；老账号只有 `tags: string[]`（按名）时 findOrCreate 回填
- 分组：备份无分组概念 → 全部 `groupId = null`
- 判重键：`(url, userId)`

## 权限最小集

`permissions: ["storage", "alarms", "notifications"]` + `host_permissions: ["<all_urls>"]`。
不需要 cookies / tabs / DNR / contextMenus（anyrouter 走 credentials:include，这也是 all-api-hub 自己的默认路径）。

## 明确砍掉的原版能力（本项目不做）

Cloudflare/Turnstile 临时窗口过盾（原版约 5500 行）、voapi token 自动重同步、content script、sidepanel、WebDAV、用量分析、模型价格对比、渠道管理、跨午夜签到窗口、可配置重试参数。
