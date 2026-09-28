# Writer MVP 实施计划

目标流程：新建文档 → 创建和组织章节 → 拖动调整结构 → 编辑正文 → 插入常见内容 → 自动章节编号
→ 保存和重新打开 → 全文预览 → 导出 Word → 导出 PDF，且正常操作不会损坏数据。

相关长期约束：`AGENTS.md`、`docs/decisions.md`、`docs/project-format.md`、`docs/known-risks.md`。

每个阶段完成标准：相关测试 → 全量 `npm test` → `npm run typecheck` →
（有 Rust 代码后）`cargo test` + `cargo clippy` → 自查 → 更新本文件。

## 状态总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| S0 | 章节树 Domain / Application / UI（已有） | ✅ 完成 |
| S1 | 文档模型 + 项目格式（manifest 解析/生成、文件名规则） | ⏳ 进行中 |
| S2 | Rust 存储层：保存事务、恢复、打开/新建、Tauri command | 待开始 |
| S3 | Application：存储端口、项目会话（dirty 边界、串行保存、自动保存） | 待开始 |
| S4 | 应用外壳：两栏布局、新建/打开/保存、快捷键、关闭保护、界面状态恢复 | 待开始 |
| S5 | CodeMirror 正文编辑、按内容决定删除确认 | 待开始 |
| S6 | 插入内容：工具栏、图片资源导入、表格等 | 待开始 |
| S7 | 全文预览（Rust pulldown-cmark 渲染） | 待开始 |
| S8 | Word 导出（docx-rs） | 待开始 |
| S9 | PDF 导出（Typst）+ 字体 fallback | 待开始 |
| S10 | 加固：大文档、深层嵌套、极端输入、回归 | 待开始 |

## S1 文档模型 + 项目格式

- Domain `document`：`WriterDocument { title, tree, contents }`，不变量"contents 的 key 集合 = 树的 id 集合"；
  `replaceTree` 在结构变化后同步 contents（删除的章节去掉正文、新章节补空正文）；`setContent`。
- Infrastructure `project_format`：`contentFileName(ChapterNumber)`、`buildManifest(doc)`、
  `parseManifest(unknown)`（格式、版本、validateTree、files 一致性、深度上限 32）。
- 深度上限在信任边界落地（known-risks #1）。

## S2 Rust 存储层

- `storage` 模块：按 `docs/project-format.md` 第 5 节实现 staging + journal + 前滚。
- 文件操作经过可注入故障的抽象，测试对"每一步失败/崩溃"逐一验证：恢复后磁盘必为旧状态或新状态。
- 覆盖：A/B 交换、子树移动、插入导致大量后移、删除子树、孤儿文件、中文路径、重复保存、缺失正文、非 UTF-8。
- Tauri command：`project_create` / `project_open` / `project_save`；加入 dialog 插件。

## S3 Application 项目会话

- 端口 `ProjectStorage`（create/open/save），Tauri 实现放在 infrastructure。
- `ProjectSession`：revision 计数；保存以快照为单位，只有存储成功才推进 `savedRevision`；
  保存串行化，期间请求合并；防抖自动保存；失败保持 dirty 并暴露错误。

## S4 应用外壳

- 欢迎页（新建/打开）；两栏独立滚动布局（ui-spec §27）；Cmd/Ctrl+S；保存状态指示；
  关闭窗口时 dirty 保护；`.writer/ui-state.json` 恢复选中章节与折叠状态；
  记住上次打开的项目；ChapterManager 改为受控组件；当前章节自动滚动可见（ui-spec §28）。
- 折叠状态随项目切换重置（known-risks #3）。

## S5 正文编辑

- CodeMirror 6 + Markdown；每章节独立 EditorState（保留撤销历史）；保留原换行符风格。
- 删除确认按"有正文或有子章节"判断（ui-spec §23）。

## S6 插入内容

- 工具栏：粗体、斜体、列表、有序列表、引用、代码块、表格、图片。
- 文本变换为纯函数（可单测）；图片经 Rust 复制到 `assets/`，重名自动加后缀，引用 `../assets/<name>`。

## S7 全文预览

- Rust 用 pulldown-cmark 把按树顺序拼接的全文渲染为 HTML；章节标题由深度+编号生成；
  图片经 asset 协议显示；缺失图片给出占位。

## S8 Word 导出

- 共享中间模型（Markdown → Block），docx-rs 生成：标题样式（导航窗格可用）、段落、列表、引用、
  代码、表格、图片（按尺寸缩放）、中文字体（eastAsia）。

## S9 PDF 导出

- 同一中间模型 → Typst 源（用户文本一律以字符串字面量注入，杜绝转义问题）→ PDF；
  字体按角色的 fallback 链选择；无中文字体时警告。

## S10 加固

- 1000+ 章节、32 级嵌套、超大正文、重复打开/保存、导出失败路径、Unicode 路径的端到端测试。

## 进度记录

（每个阶段完成后在此追加：完成内容、验证结果、发现的问题与修正。）
