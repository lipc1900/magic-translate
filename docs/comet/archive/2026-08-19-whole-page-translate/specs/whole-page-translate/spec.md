# Spec — 整页翻译（whole-page-translate）

点击后将英文网页整页替换为简体中文，保留结构与布局，支持一键还原。

## 提取

- `document.createTreeWalker(root, NodeFilter.SHOW_TEXT)` 遍历文本节点，跳过 `code/pre/kbd/samp/script/style/noscript/textarea/select/option/iframe/template`、`contenteditable`、`hidden`/`aria-hidden`、`display:none`、空文本、纯数字/符号/URL、长度 <2 的碎片。
- `<a>` 只译可见文字不动 `href`；`img` 的 alt/title 默认不译。
- 动态页面：`MutationObserver` 节流 300ms 处理新增节点；渲染前 disconnect 避免自激。
- 重复保护：内存 `WeakSet<Node>`；「还原/重译」清空重扫。

## 切分

- 块级节点（`p/li/td/h1-h6` 等）为基本发送单元；单节点 >1500 字符按句边界切（`Intl.Segmenter`），不从句子中间断开。
- 每批 2–4 句或 ≤1500 字符，同一自然段不拆到不同请求。
- 上下文：background 维护页面会话滑动窗口，请求附带上文 ~2000 字符（只读不重译）。

## 翻译（background → DeepSeek）

- `fetch("https://api.deepseek.com/chat/completions", {stream:true})`，SSE 流式解析。
- 参数：`model=deepseek-chat`、`temperature 0.2`、`top_p 0.9`；系统指令「你是专业中英译者，只输出译文，不解释」。
- 按块流式返回，background 解析后通过消息推给 content 增量渲染。
- 并发：全局 2–3 并发请求，队列背压。

## 渲染

- 整页**原地替换**：只改文本节点，不重建 DOM。
- 增量渲染：token 按 `requestAnimationFrame` 合并，`DocumentFragment` 批量挂载，避免逐句 reflow。
- **锚点滚动补偿**：批量替换后 `scrollTo` 补偿，避免页面跳动。
- 视口优先：`IntersectionObserver` 优先译视口+下一屏，其余放 `requestIdleCallback` 队列。

## 缓存（三级）

1. 内存 `Map`（LRU，会话级）。
2. `IndexedDB` 持久化：`hash(句子) → {src,dst,ts}`。
3. 整页缓存：`URL + hash` 存整页译文，重访直接恢复。

## 还原

- 原文保留在内存映射（或 `data-orig`），切换即恢复；≤1 次点击。

## 站点适配（v1 简化）

- 通用启发式：优先 `article > main > [role=main]`，取文本密度最高容器。
- GitHub/文档站走同一套规则（跳过 code/pre）。
- 站点黑名单可配置（popup）。

## 性能目标（详见 acceptance.md）

- 首段 ≤2s、整页流式、缓存命中 ≤50ms、主线程长任务 ≤50ms、可滚动可取消。
