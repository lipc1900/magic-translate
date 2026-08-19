# Verification — whole-page-translate

## 验证方式

Comet Native Verify：三轮独立的只读 Verifier 子代理，逐条对照 `acceptance.md`（12 条）静态审查源码与构建产物。

## 判定结果

- **静态可验证项：全部 PASS**（功能 5 条、稳定性 3 条、动态内容/去重、以及性能项的结构性部分）。
- **需真机验收项（blocked → 待用户实测，非代码失败）**：
  1. 首段译文 ≤2s（acceptance #6）
  2. 整页 95% 块 ≤20s（#7）
  3. 缓存命中整页渲染 ≤50ms（#8）
  4. 主线程长任务 ≤50ms、可滚动可取消（#9）

> 这 4 条依赖真实浏览器 + 真实 DeepSeek Key 计时，本开发环境无法启动 Chrome，故标记为待真机验收。

## 三轮 Build↔Verify 循环的修复记录

1. 取消/还原 → 后台停止队列（`CANCEL_SESSION`）
2. rAF 回调二次校验（防还原被覆盖 / 二次替换）
3. MV3 service worker 保活（`chrome.runtime.connect` port）
4. 缓存写入容错（超配额/单条 >8KB 不缓存但照常渲染）
5. 401 → 专门提示 + 打开选项页
6. MutationObserver 动态内容（防抖 500ms）
7. 隐藏元素跳过（`[hidden]`/`display:none`/`.sr-only`/`.hidden`）
8. 首批更小（6 条/1000 字符）+ cacheGet 并行
9. INVALID_KEY 无限反馈循环回归修复（UI 元素 `data-mt-ui` 跳过收集 + 一次性提示 + 失败重置状态）

## 结论

开发完成、`wxt build` 通过、`tsc --noEmit` 类型检查通过、静态验证 PASS。性能指标需用户在真实浏览器 + 真实 DeepSeek Key 下实测。
