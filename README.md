# APIManager

精简版 AI 中转站账号管理浏览器扩展——只做三件事：**账号管理（分组 + 标签）**、**余额查看**、**每日自动签到**。

灵感来自 [all-api-hub](https://github.com/qixing-jk/all-api-hub)：它很强大，但如果你只用得上账号管理和签到，这个精简版会更清爽。本项目为**独立实现**，仅参考了各中转站的公开接口行为（端点、请求头、响应语义），未复用其代码（all-api-hub 为 AGPL-3.0 协议）。

## 功能

- **账号管理**：录入站点账号（URL / Access Token / 用户 ID），手动刷新余额；签到成功后自动顺带刷新
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
