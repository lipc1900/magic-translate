# Brief — Whole-Page Translate（整页英文→中文替换，纯插件）

> Comet Native · Change: `whole-page-translate` · 阶段：Shape（已确认）

## Outcome（结果）

安装一个纯 Chrome 插件并填入 DeepSeek API Key 后，**点击插件图标 → 当前英文网页整页自动替换为简体中文**；再点一次**一键还原英文原文**。翻译走云端 DeepSeek 流式输出，首段 ≤2s 可见、整页边译边替换、不卡顿；二次访问走本地缓存秒开。

## Scope（本 change 范围）

1. Chrome MV3 扩展：content script + background service worker + popup（设置/开关）。
2. 整页翻译链路：提取文本节点 → 切分 → DeepSeek 流式翻译 → 原地替换渲染 → 缓存 → 一键还原。
3. 设置：API Key、目标语言（默认简体中文）、站点开关。

## Non-goals（不做）

- 视频字幕翻译 / 无字幕语音转文字（已砍）。
- 本地服务 / Python / 本地模型（不需要，翻译直接走云 API）。
- 其他语言 → 中文（预留架构可扩展，不实现）。
- 双语对照、PDF、漫画、图片 OCR、多用户。

## Decisions（关键决策，已确认）

1. **纯扩展、无本地服务**：翻译由 background 直接调 DeepSeek，无需启动任何本地进程。
2. **后端 = DeepSeek `deepseek-chat`**：API Key 存 `chrome.storage.local`，仅本机扩展可见。
3. **显示 = 整页原地替换**（默认），一键还原原文。
4. **目标语言 = 简体中文**，源语言自动检测（英文优先）。
5. **框架 = WXT + TypeScript**（MV3），content script 保持轻量。

## Constraints（约束）

- 运行机 Dell Precision 7520（i7-7700HQ/16GB/Quadro M1200），但纯扩展 + 云翻译，硬件无关紧要。
- 需用户提供 DeepSeek API Key（`https://platform.deepseek.com` 创建）。
- 单用户自用。

## Open Questions

无阻塞问题。
