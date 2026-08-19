# Magic Translate

一键整页英文翻译成中文的 Chrome 插件（DeepSeek）。

## 功能

- 点击工具栏图标 / `Alt+T` / 右键「翻译本页为中文」→ 整页英文替换为中文
- 再点一次 → 一键还原英文原文
- 分批渐进翻译（视口优先、并发 3、内容哈希缓存，二次访问秒开）
- 保留页面结构（代码块、链接、图片、表格不被破坏）

## 使用

1. 到 <https://platform.deepseek.com> 创建 API Key。
2. 安装依赖并构建：

   ```bash
   npm install
   npm run build
   ```

3. 打开 `chrome://extensions`，开启「开发者模式」，点「加载已解压的扩展程序」，选择本项目的 `.output/chrome-mv3` 目录。
4. 点扩展图标，在弹出的设置页里填 DeepSeek API Key，保存。
5. 打开任意英文网页，点工具栏图标即可翻译。

## 开发

```bash
npm run dev   # 开发模式（热更新）
npm run build # 生产构建
npm run zip   # 打包 zip
```
