# APIManager

精简版 AI 中转站账号管理浏览器扩展——只做三件事：**账号管理（分组 + 标签）**、**余额查看**、**每日自动签到**。

灵感来自 [all-api-hub](https://github.com/qixing-jk/all-api-hub)：它很强大，但如果你只用得上账号管理和签到，这个精简版会更清爽。本项目为**独立实现**，仅参考了各中转站的公开接口行为（端点、请求头、响应语义），未复用其代码（all-api-hub 为 AGPL-3.0 协议）。

## 功能

- **账号管理**：录入站点账号（URL / Access Token / 用户 ID），手动刷新余额；签到成功后自动顺带刷新
- **登录凭证**：为账号保存登录方式（账号密码 / OAuth 授权记录）——密码经主密码派生密钥（PBKDF2 + AES-GCM）加密后存本地，可解锁查看/复制；仅想记凭证、不接签到的站也能录入
- **双层分类**：分组（popup 主列表按组折叠，适合"常用 / 备用 / 白嫖"）+ 多标签（快速筛选）
- **自动签到**：每日在设定时间窗口内的随机时刻执行；失败 30 分钟后自动重试（每账号每日最多 3 次）；完成后系统通知
- **一键迁移**：直接导入 all-api-hub 的备份 JSON（账号、Token、标签自动映射）
- **自身备份**：导出 / 合并导入 / 覆盖导入

## 支持的站点类型

| 类型 | 签到 | 鉴权 |
|---|---|---|
| New API 系 | ✅ | Access Token |
| Veloera | ✅ | Access Token |
| VoAPI v2 | ✅ | 页面 JWT（会过期，过期后扩展会标黄提醒更新） |
| AnyRouter | ✅ | 浏览器 Cookie（需保持该站在浏览器中已登录） |
| Sub2API | ❌（无内置签到） | Access Token（仅查余额） |
| 其他 | ❌ | 通用记录型——仅账号管理，不拉余额不签到 |

## 开发

```bash
npm install
npm run dev       # 拉起 Chrome 加载扩展（热更新）
npm test          # vitest 单测
npm run compile   # tsc 类型检查
npm run build     # 产出 .output/chrome-mv3
npm run zip       # 打包 zip
```

手动加载：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `.output/chrome-mv3`。

## 权限说明

- `storage`：本地保存账号数据（不上传任何服务器）
- `alarms`：自动签到定时
- `notifications`：签到结果通知
- `<all_urls>`：向你添加的中转站发起余额 / 签到请求

## 数据安全

所有数据（含 Access Token）仅存于浏览器本地 `chrome.storage.local`。导出的备份 JSON 含明文 Token，请妥善保管。

**登录密码**额外走主密码加密：在「安全」页设置主密码后，密码以 PBKDF2（310k 迭代）派生的 AES-GCM 密钥加密存储，主密码与派生密钥都不落盘（密钥仅存 `chrome.storage.session`，浏览器关闭即清空）。主密码没有找回途径——忘记只能在「安全」页重置保险库，届时所有已存密码会被清除（Token 与 OAuth 记录不受影响）。备份里的密码为密文，换设备恢复需配同一主密码解锁。
