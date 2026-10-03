# 随应用打包的字体

构建正式包前由 `node scripts/fetch-fonts.mjs` 下载（tauri.conf.json 的 beforeBuildCommand 自动执行），字体文件不提交到仓库：

- Noto Serif CJK SC Regular / Bold（宋体类）
- Noto Sans CJK SC Regular / Bold（黑体类）

许可证：SIL Open Font License 1.1（`LICENSE-OFL.txt`）。PDF 排版时这些字体在中文候选中排在最前（`export::fonts::families`），
不同机器上的 PDF 中文字形与折行一致。Word 只写字体名，不受影响。docs/decisions.md 第 6 节。
