# all-api-hub 调研参考（协议事实库）

> 本文档是对 [all-api-hub](https://github.com/qixing-jk/all-api-hub)（AGPL-3.0）源码调研的**事实性协议信息**汇总——接口端点、请求头、响应语义、备份格式。本项目所有代码为独立重写，仅采信这些事实，不搬运其实现。
> 调研基准：all-api-hub v3.52.0（2026-07-15，本地 clone 于 `D:\Desktop\www\all-api-hub`）。

## 签到接口表

| 站点类型 | 签到 | 今日状态查询 | 鉴权 |
|---|---|---|---|
| new-api | `POST /api/user/checkin`，body `"{}"` | `GET /api/user/checkin?month=YYYY-MM` → `data.stats.checked_in_today` | `Authorization: Bearer <token>`；接口 404/500 = 站点不支持签到 |
| veloera | `POST /api/user/check_in`（无 body） | `GET /api/user/check_in_status` → `data.can_check_in`（true=今天还能签） | Bearer |
| anyrouter | `POST /api/user/sign_in`，body `"{}"`，加头 `X-Requested-With: XMLHttpRequest` | 无独立接口，靠签到响应判断 | **强制 Cookie**：`credentials:"include"` 复用浏览器登录态；**空 message = 已签** |
| voapi-v2 | `POST /api/check_in`（无 body），提交后再 GET stats 确认 | `GET /api/check_in/stats` → `todaySigned` | **raw JWT（无 Bearer 前缀）**，会过期 |

voapi-v2 响应信封 `{code, data, msg}`：

- `code 0` = 成功
- `code 1` + msg 匹配 `/signed|check/i` = 已签到
- `code 2` + msg 匹配 `/auth\s*expire|unauthorized|token|jwt|login/i` = JWT 过期（→ 标记账号 expired）

anyrouter 响应 `{code, ret, success, message}`：`success:false`=失败；message 含 `success`/`签到成功`=成功；空 message 或命中已签词表=已签。

**"已签到" message 词表**（忽略大小写）：`今天已经签到` / `已经签到` / `已签到` / `already`。

## 余额接口

| 站点类型 | 接口 | 换算 |
|---|---|---|
| new-api / veloera / anyrouter | `GET /api/user/self` → `data.quota` | **USD = quota / 500000** |
| voapi-v2 | `GET /api/user/info` → `basicBalance + bindBalance` | 已是美元（可能是字符串） |

## 使用金额接口

- **累计已用**：new-api 系 `/api/user/self` 响应顺带 `data.used_quota`（quota 单位，÷500000）；sub2api `/api/v1/auth/me` 顺带 `data.quota_used`（已是美元）；voapi-v2 账号级无此字段（仅 token 级 `used`，未采用）
- **今日消耗**（仅 new-api 系）：`GET /api/log/self/stat?p=1&page_size=10&token_name=&model_name=&start_timestamp=<本地0点秒>&end_timestamp=<本地23:59:59秒>&type=2` → `data.quota`（÷500000）；type=2 是消费日志（LogType.Consume）

## 通用请求头

- `Content-Type: application/json`
- userId 兼容头扇出（各分叉后端认不同的头，全部带上）：`New-API-User`、`Veloera-User`、`voapi-user`、`User-id`，值 = 站点用户 id
- token 模式 `credentials:"omit"`；cookie 模式 `credentials:"include"`
- 响应 content-type 非 JSON（返回登录页 HTML）→ 视为未登录/被 Cloudflare 拦截

## 调度语义（chrome.alarms）

- 双闹钟：每日 `checkin:daily` + 重试 `checkin:retry`
- 每日窗口内**均匀随机取时刻**；`lastDailyRunDay`（本地 YYYY-MM-DD）保证每日至多一跑；`dailyAlarmTargetDay` 防休眠后陈旧闹钟误触发
- `onInstalled` / `onStartup` 都要重排闹钟（Chrome 重启会清 alarms）
- MV3 下重试等待必须用 alarm，不能 setTimeout（service worker 会被杀）
- 是否已签以 provider 返回的 `already_checked` 为准，不信任缓存状态

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
