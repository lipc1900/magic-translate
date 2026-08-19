# Spec — 扩展核心（extension-core）

纯 Chrome MV3 扩展骨架、入口、消息协议与设置。

## 结构

- WXT + TypeScript，产物 Manifest V3。
- 模块：`content`（页面注入）、`background`（service worker）、`popup`（设置/开关）。

## 权限（manifest）

- `host_permissions`：`https://api.deepseek.com/*`（background 直接调 DeepSeek，绕过 CORS）、`https://*/*`（向页面注入翻译）。
- `storage`、`scripting`、`contextMenus`、`commands`。
- 不申请多余权限。

## 消息协议

- content ⇄ background 通过 `chrome.runtime.sendMessage` / `onMessage` 传递类型化消息：`translate-page` / `restore-page` / `translate-progress` 等。
- background 负责：调用 DeepSeek、流式解析、缓存读写、向 content 推送增量译文。
- 配置（API Key、目标语言）存 `chrome.storage.local`。

## 入口与交互

1. **地址栏图标单击**：主入口，在「翻译整页 / 还原原文」间切换。
2. **快捷键**：`Alt+T` 翻译整页。
3. **右键菜单**：「翻译本页」「还原原文」。
4. **popup**：目标语言选择、API Key 录入、开关、（可选）当前页状态。

## 状态与反馈（红线）

- 任意交互 ≤100ms 有视觉反馈。
- 翻译中显示进度（顶部细进度条 + 已译块计数），>10s 可取消。
- 一键还原，取消/失败不丢失已渲染内容。

## 错误与降级

- 未配置 API Key：点击后弹提示引导去 popup 填 Key。
- 单块失败：重试 1 次，仍失败标记并计数，不阻塞其他块。
- 超时：`AbortController` 中止。
