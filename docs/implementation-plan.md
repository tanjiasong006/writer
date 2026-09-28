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
| S1 | 文档模型 + 项目格式（manifest 解析/生成、文件名规则） | ✅ 完成 |
| S2 | Rust 存储层：保存事务、恢复、打开/新建、Tauri command | ✅ 完成 |
| S3 | Application：存储端口、项目会话（dirty 边界、串行保存、自动保存） | ✅ 完成 |
| S4 | 应用外壳：两栏布局、新建/打开/保存、快捷键、关闭保护、界面状态恢复 | ✅ 完成 |
| S5 | CodeMirror 正文编辑 | ✅ 完成 |
| S6 | 插入内容：工具栏、图片资源导入、表格等 | ✅ 完成 |
| S7 | 全文预览（Rust pulldown-cmark 渲染） | ⏳ 进行中 |
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

### S1（完成）

- 新增 Domain `document`（WriterDocument、replaceTree、setContent、isChapterBlank）。
- 新增 infrastructure `project_format`（文件名规则、buildManifest、parseManifest）。
- 发现：深度上限若只放在文件格式里，用户可以通过拖拽造出"能编辑但存不下"的树。
  修正：`MAX_CHAPTER_DEPTH = 32` 放进 Domain `chapter_tree`，`validateTree` 超限即停止递归，
  `validateMove` / `insertChapter` 拒绝超限结果（新 reason `depth-exceeded`，UI 已补文案）。
  known-risks #1 因此关闭。
- 验证：npm test 200/200，vue-tsc 通过。

### S2（完成）

- `src-tauri/src/storage/`：create / open / save，staging + journal + 前滚，孤儿文件移入 `.writer/recovered/`。
- 换名只是编号变化时优先硬链接进 staging（不复制数据、字节不变），不支持硬链接时复制。
- `Fs` 抽象 + `FaultyFs`：崩溃矩阵测试在保存的**每一个**文件系统操作处注入失败并模拟崩溃，
  验证重开后磁盘恰为旧/新状态之一、已提交必前滚、之后重试收敛。覆盖 A/B 交换、子树移动、
  顶部插入导致 20 个文件后移、删除子树 + 编辑、纯编辑、新建项目。
- 变异验证：去掉 journal 提交点后崩溃矩阵立即失败，说明测试确实约束了协议。
- 其他：字节级保留（BOM/CRLF）、未变文件不被触碰、非法文件名/路径穿越/重名/恶意 journal 拒绝、
  缺失正文与非 UTF-8 拒绝打开、中文 + emoji 路径。
- Tauri command：`project_create` / `project_open` / `project_save`（后台线程 + 全局串行锁）；接入 dialog 插件。
- 验证：cargo test 23/23，cargo clippy --all-targets 无警告，npm test / vue-tsc 通过。
- 备注：macOS 上 fsync 为 F_FULLFSYNC，大批量换名时的耗时在 S10 测量。

### S3（完成）

- `application/project_storage.ts`：存储端口与机器可读的失败原因。
- `application/project_session.ts`：revision / savedRevision 快照语义，失败保持 dirty 并暴露错误，
  保存串行且期间请求合并，防抖自动保存 + 失败重试，close 时尽力提交并报告结果。
- `application/project_lifecycle.ts`：openProject / createProject。
- `infrastructure/tauri_project_storage.ts`：Tauri 实现，Rust 返回的数据在这里校验后再进 Domain。
- `testing/memory_project_storage.ts`：模拟"未报告变化的章节保留磁盘旧内容"，漏报变化会被测试发现；Storybook 也可用。
- 共享格式契约：`src-tauri/fixtures/示例项目` 同时被 TS 与 Rust 测试读取，防止两侧格式漂移。
- 验证：npm test 229/229，vue-tsc 通过，cargo test 24/24，clippy 无警告。

### S4（完成）

- App 状态机：启动重开上次项目 → 欢迎页 / 工作区；新建（标题取文件夹名）、打开、切换项目。
- `releaseSession`（Application）：切换项目与关闭窗口共用——先保存，失败时由用户决定是否放弃，拒绝则会话保持可用。
- `DesktopShell` 端口（Application）+ Tauri 实现 + 内存实现；UI 通过 provide/inject 取得服务。
- 工作区：顶栏（可改文档标题、保存状态与失败原因、重试、新建/打开）、260px 章节栏与正文区独立滚动、Cmd/Ctrl+S。
- ChapterManager 改为受控组件（v-model:tree / selected-id / collapsed-ids）；
  删除确认按 ui-spec §23：无子章节且无正文直接删除，否则确认，文案统计全部后代并说明是否含正文。
- 选中章节自动滚动可见（§28）；界面状态（选中、折叠）存 `.writer/ui-state.json`，失效章节被忽略（known-risks #3 关闭）。
- Domain：新增 `countDescendants`、`hasContent`。
- 验证：npm test 257/257，vue-tsc、vite build、build-storybook 通过；cargo test 25/25，clippy 无警告。
- 未做（有意延后）：↑↓ 键盘导航（known-risks #2）、侧栏宽度拖动（spec P1）。

### S5（完成）

- `ui/editor/ChapterEditor.vue`：CodeMirror 6 Markdown 源码编辑，自动换行、列表续行（markdownKeymap）、搜索、Tab 缩进、占位提示；
  章节编号与标题显示在编辑器上方，不进入正文。
- 每章节缓存 EditorState，切换后撤销历史仍在；change 携带编辑发生时的章节 id。
- 字节保真：纯 CRLF 文件显式使用 CRLF 行分隔符，读回用 `sliceDoc()`；未编辑的章节永不写回。
- 工作区接入：编辑 → session.setContent → 自动保存 / Cmd+S。
- 验证：npm test 272/272（含 App 级：编辑保存、切换章节写入正确章节、自动保存、新建章节后编辑器切换），
  vue-tsc、vite build、build-storybook 通过。
- 真实应用：Tauri 调试版可启动，dev server 能编译全部模块，无运行时错误日志。
  **限制**：本环境没有屏幕录制权限，无法截图或操作原生对话框；手动验收清单见文末。

### S6（完成）

- `ui/editor/markdown_commands.ts`：粗体 / 斜体（包裹与取消）、无序 / 有序列表 / 引用（按行切换，列表类型互换）、
  代码块、表格模板、图片；块级内容自动与前后段落隔开空行。纯 StateCommand，逐一单测。
- `EditorToolbar.vue` + 快捷键 Mod-B / Mod-I；按钮不抢编辑器焦点。
- 图片：`storage::assets::import_asset`（Rust）复制进 `assets/`，清洗文件名、内容相同复用、重名加后缀、原子写入；
  正文插入 `![名](../assets/名.png)`。选择文件期间切换了章节时，图片追加到发起请求的章节。
- 验证：npm test 290/290，vue-tsc 通过，cargo test 29/29，clippy 无警告。

## 手动验收清单（需要在真实桌面环境执行）

1. 新建文档 → 选择位置 → 出现空状态；新建章节、子章节，输入正文。
2. 拖动章节改变结构 → 等待"已保存" → 在 Finder 中确认 `content/ch_*.md` 文件名随编号变化、内容正确。
3. 退出应用重开 → 自动打开上次项目，选中章节与折叠状态恢复。
4. 把项目文件夹设为只读 → 编辑 → 状态显示"保存失败"；关闭窗口时出现确认。
