# Writer MVP 实施计划

目标流程：新建文档 → 创建和组织章节 → 拖动调整结构 → 编辑正文 → 插入常见内容 → 自动章节编号
→ 保存和重新打开 → 导出 Word → 导出 PDF → 在外部阅读器检查，且正常操作不会损坏数据。

相关长期约束：`AGENTS.md`、`docs/decisions.md`、`docs/project-format.md`、`docs/known-risks.md`。

每个阶段完成标准：相关测试 → 全量 `npm test` → `npm run typecheck` →
（有 Rust 代码后）`cargo test` + `cargo clippy` → 自查 → 更新本文件。

## 当前状态（阅读说明）

本文件按时间顺序记录，**后面的章节会取代前面章节中的描述**；被取代处已就地标注。当前实现的要点：

- 正文编辑器是 ProseMirror（见"正文编辑器迁移"）。S5 / S6 中的 CodeMirror 与 `markdown_commands.ts` 已随迁移删除；
  `EditorToolbar.vue` 在"以 macOS HIG 为基准的界面调整"中删除，格式命令移到菜单栏、右键菜单与快捷键。
- 命令入口：菜单栏 `ui/app_shell/app_menu.ts`（同时是工作区快捷键的唯一来源，菜单项 id 有类型检查）、
  快捷键定义 `ui/common/shortcuts.ts`、右键菜单与按钮菜单 `ui/common/use_menu.ts`（见"以 macOS HIG 为基准的界面调整"）。
- 工作区：文档名在正文区工具栏开头，侧栏只有章节树；侧栏可调宽度、可隐藏。`Workspace.vue` 负责连接，
  独立职责在同目录的 `use_*.ts`（界面状态、侧栏、导出、焦点区域）。
- 章节树：`ChapterTree.vue` 负责渲染、选择、菜单与键盘；显示行在 `tree_rows.ts`，拖拽在 `use_tree_drag.ts`，
  内联重命名在 `use_inline_rename.ts`。键盘导航与键盘移动章节已完成。
- 尚未完成的事项见"后续（MVP 之外，按价值排序）"与文末的手动验收清单。
- 导出与样式的最新产品边界见“导出能力边界与排版职责”；旧的文档样式（共享主题、图片布局）已移除，
  编辑器使用 `ui/editor/editor_theme.ts` 的默认展示参数，Word / PDF 使用 `export::theme` 的默认输出参数。
- 应用内预览已移除（见“导出能力边界与排版职责”的实施记录）。下文关于全文预览、预览同步与相关界面的既往记录
  仅描述历史实现，不作为后续功能或验收要求；导出所需内容解析与资源能力保留。
- 全文阅读（编辑环境的连续只读展示）已实现，见“全文阅读”一节与 decisions 第 8 节。

## 状态总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| S0 | 章节树 Domain / Application / UI（已有） | ✅ 完成 |
| S1 | 文档模型 + 项目格式（manifest 解析/生成、文件名规则） | ✅ 完成 |
| S2 | Rust 存储层：保存事务、恢复、打开/新建、Tauri command | ✅ 完成 |
| S3 | Application：存储端口、项目会话（dirty 边界、串行保存、自动保存） | ✅ 完成 |
| S4 | 应用外壳：两栏布局、新建/打开/保存、快捷键、关闭保护、界面状态恢复 | ✅ 完成 |
| S5 | 正文编辑（初版 CodeMirror，后迁移到 ProseMirror，见"正文编辑器迁移"） | ✅ 完成 |
| S6 | 插入内容：工具栏、图片资源导入、表格等 | ✅ 完成 |
| S7 | 全文预览（历史实现） | 已移除；由全文阅读（编辑环境）取代 |
| S8 | Word 导出（docx-rs） | ✅ 完成 |
| S9 | PDF 导出（Typst）+ 字体 fallback | ✅ 完成 |
| S10 | 加固：大文档、深层嵌套、极端输入、回归 | ✅ 完成（自动化部分） |

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

> 历史实现，已确认移除；本节不是后续能力要求。内容解析继续用于 Word / PDF 导出。

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
  （已被取代：两项均已完成，见"后续 2"与"界面整体重做"。）

### S5（完成）

> 已被取代：编辑器已整体迁移到 ProseMirror，本节的 CodeMirror 实现已删除，见"正文编辑器迁移"。

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

> 已被取代：`markdown_commands.ts` 已随 ProseMirror 迁移删除，命令见 `ui/editor/commands.ts`；`EditorToolbar.vue`
> 在"以 macOS HIG 为基准的界面调整"中删除。图片导入（Rust `storage::assets`）仍然有效。

- `ui/editor/markdown_commands.ts`：粗体 / 斜体（包裹与取消）、无序 / 有序列表 / 引用（按行切换，列表类型互换）、
  代码块、表格模板、图片；块级内容自动与前后段落隔开空行。纯 StateCommand，逐一单测。
- `EditorToolbar.vue` + 快捷键 Mod-B / Mod-I；按钮不抢编辑器焦点。
- 图片：`storage::assets::import_asset`（Rust）复制进 `assets/`，清洗文件名、内容相同复用、重名加后缀、原子写入；
  正文插入 `![名](../assets/名.png)`。选择文件期间切换了章节时，图片追加到发起请求的章节。
- 验证：npm test 290/290，vue-tsc 通过，cargo test 29/29，clippy 无警告。

### S7（完成）

- Rust `render/`：`markdown.rs` 把正文解析为统一的块 / 行内模型（表格、列表、引用、代码、图片、删除线、任务列表），
  引用 / 列表嵌套超过 32 层时压平为文本（10000 层 `>` 不会栈溢出）；`html.rs` 输出全文预览。
- 安全：原始 HTML 一律当作文本；所有文本转义；链接只展示不跳转；图片只解析项目目录内的文件（规范化路径，防符号链接逃逸）。
- 章节标题 / 编号来自结构（`buildRenderRequest`，按阅读顺序展开）；正文内的 `#` 标题层级叠加在章节层级之下（已取消：正文不支持标题，Markdown 标题作为文字，见 decisions 第 8 节）。
- 图片经 asset 协议显示（运行时把项目目录加入 scope）；缺失图片显示占位。
- 工作区"预览 / 返回编辑"切换；预览随编辑防抖刷新、只采用最新结果；点击预览中的章节同步选中，树中选中章节时预览滚动到该处。
- 验证：npm test 297/297，vue-tsc、build-storybook 通过；cargo test（render 18 项）通过，clippy 无警告。

### S8（完成）

- Rust `export/`：`docx.rs`（A4、页脚页码、Title / Heading1–9 / Quote / Code / Caption 样式、
  标题带大纲级别可用于导航窗格、编号为静态文本与预览一致、列表编号实例互不接续、表格、链接、图片按正文宽度缩放）；
  `fonts.rs`（全项目唯一的字体配置：按角色的跨平台 fallback 链 + Word 字体名）；`images.rs`（安全加载图片）；
  `write_output`（临时文件 + fsync + rename，失败不留半个文件、不破坏旧文件）。
- 发现并修正：
  - docx-rs 的 `Pic::new` 对损坏图片直接 `expect`，release 构建 `panic = abort` 会让整个应用退出 →
    自行解码（带尺寸 / 内存上限），损坏图片输出占位文字并记入报告。
  - docx-rs 默认已定义 numbering id 1，与自定义编号重复 → 自定义 id 从 10 开始，测试断言 id 唯一。
  - XML 1.0 不允许的控制字符会让 Word 拒绝打开整个文件 → 所有文本过滤；不安全的链接只保留文字。
  - 中文正文中的软换行在预览 / Word / PDF 中都会变成多余空格 → 统一在 Markdown 模型中去除中文之间的软换行。
- 前端：导出菜单（Word / PDF）、选择保存位置、导出当前内存文档（含未保存修改）、完成提示与"在文件夹中显示"、图片缺失提示。
- 验证：cargo test 通过（docx 7 项 + 图片 5 项，含 500 章、32 级、控制字符、损坏 / 超大图片），
  生成的样例能被 docx-rs 读取器与 macOS textutil 独立解析；npm test 301/301。
- 限制：本机没有 Word / LibreOffice，Word 中的最终排版需手动核对（见验收清单）。

### S9（完成）

- Rust `export/pdf.rs`：统一模型 → Typst 源码 → 内嵌 Typst（typst / typst-pdf / typst-kit 0.15）→ PDF。
  A4、页码、PDF 书签（来自标题，含编号）、标题 / 正文 / 等宽字体按 `fonts.rs` 的角色 fallback 链选择。
- 用户文本全部以 Typst 字符串字面量注入；测试覆盖 `"]#panic(...)[`、`$`、`#import` 等注入尝试，输出为原样文字。
- 文档含中文而本机没有中文字体时返回 `no-cjk-font`，纯英文文档不受影响（用只含内嵌字体的字体库测试）。
- Typst 文件 id 全局驻留且有上限 → 虚拟路径固定；每次导出后 `comemo::evict(0)`，长时间运行不累积内存。
- 字体库全进程扫描一次，应用启动后后台预热。
- 稳定性：release 改为 `panic = "unwind"`，第三方排版库 panic 只让本次导出失败（docs/decisions.md 第 7 节）。
- 独立验证：PyMuPDF 解析样例 PDF —— 文字、编号、中文折行、书签结构、图片、嵌入字体
  （宋体 / Times New Roman / 黑体 / Arial / Menlo）均正确。
- 体积：release 可执行文件 46 MB（strip + LTO），gzip 后约 21 MB；其中 Typst 内嵌字体约 9.6 MB
  （若需要可去掉 `embedded-fonts`，改为完全依赖系统拉丁字体，体积约减少 9.6 MB）。
- 验证：cargo test 66 项 + 3 项手动样例 / 性能测量，clippy 无警告；npm test 302/302。

### S10（完成自动化部分）

- 性能（debug 构建）：500 章节最前面插入一章 → 501 个文件换名保存 426 ms；单章编辑保存 50 ms；打开 71 ms。
  UI：1000 章节、两级嵌套的文档打开、编辑、保存测试通过；输入时不再为每次按键重算整棵树的编号。
- 项目独占锁（`.writer/lock`，操作系统级 advisory lock）：同一项目不能被两个 Writer 进程同时打开，
  进程崩溃时自动释放；不会在非项目目录中创建任何文件。
- Cmd+Q / 菜单退出改走窗口关闭流程（保存 → 失败时询问），关闭与退出并发时只处理一次。
- Word 深层嵌套列表钳制在已定义的 0–8 级。
- 页面语言设为 zh-CN（webview 按语言选择汉字字形与默认中文字体）。
- 已知风险补充（known-risks #4–#6）：外部程序同时修改项目文件、真实桌面端到端验证、安装包体积。
- 验证：npm test 304/304，vue-tsc、vite build、build-storybook 通过；cargo test 69 项，clippy 无警告。

### 后续 2：章节树键盘导航与键盘移动（完成）

- ChapterTree（ui-spec §29 / §30，WAI-ARIA tree 模式）：↑ / ↓ / Home / End 选择可见章节；
  → 展开 / 进入第一个子章节，← 折叠 / 回到父章节；Enter 进入正文（预览中也回到编辑）；F2 重命名；
  Delete 不删除。键盘焦点（focusedId）与选中章节分开建模，选中变化时焦点跟随。
- Roving tabindex：Tab 只停在焦点行（及其 ··· 菜单按钮），折叠箭头不进 Tab 顺序；焦点行整行描边。
- 键盘移动：Alt+Shift+↑ / ↓ / ← / → 上移 / 下移 / 提升 / 降级（known-risks #2 关闭）。
  Application `keyboardMoveIntent` 只把方向换算成 `MoveIntent`，规则仍由 `moveChapterTo` / Domain 负责，
  超过层级上限时显示原有的错误文案；移动后焦点留在被移动的章节（含降级进已折叠章节时自动展开）。
- Storybook：`UI/ChapterTree/KeyboardNavigation`。
- 验证：npm test 320/320（含变异检查：去掉移动后的重新聚焦，3 项测试失败），vue-tsc、vite build、build-storybook 通过。

### 修复：打包后章节拖动无效

- 原因：Tauri 窗口默认 `dragDropEnabled: true`，拦截拖放事件用于原生文件拖入，webview 内的 HTML5 拖拽收不到 drop。
  组件测试运行在 happy-dom 中，无法发现。
- 修正：`tauri.conf.json` 窗口设置 `dragDropEnabled: false`（应用不使用原生文件拖入）；
  `tauri_window_config.test.ts` 约束该配置（去掉配置时测试失败）。
- 以后若要支持把图片等文件拖入窗口，需要改用前端的 HTML5 文件拖放，而不是重新打开这个选项。

## 完善阶段（Completion / Hardening / Polish）

不再按预定义阶段推进，而是维护一个动态问题列表：每轮重新使用、审查软件，按优先级修复。

### 验收方法

- **真实界面**：Playwright + WebKit（与 macOS Tauri webview 同一引擎）驱动 Storybook 中的 App story
  （内存存储），截图检查；大文档用 `App/LargeDocument` story（1050 章节）实测交互耗时。
- **真实磁盘**：Rust 随机模型测试 `storage::model_tests`（结构操作 + 编辑 + 随机崩溃，逐章节对照磁盘）。
- **导出质量**：`write_stress_sample`（压力样例）生成 docx / pdf；PDF 用 PyMuPDF 逐页渲染检查，
  docx 检查 XML 与 Quick Look 渲染。
- 仍需真实桌面环境：原生对话框、窗口关闭 / 退出、Word / WPS 中的最终排版（见手动验收清单）。

### 测量（WebKit，1050 章节、每章约 2000 字）

打开到可编辑约 0.7 s；每次按键到下一帧约 17 ms（一帧）；切换章节 64 ms；折叠 36 ms。
当时暂不需要虚拟滚动（后已实现，见“P2-7 章节树虚拟滚动”）。

导出同一文档（约 210 万字、1000 余页；release 构建，`bench_large_document`）：解析 8 ms、预览 HTML 9 ms（6 MB，
WebKit 排版约 0.4 s，只在预览打开且文档变化时发生）、Word 0.05 s、PDF 6.2 s（期间显示"正在导出…"）。

### 问题列表

状态：✅ 已修复　⬜ 待处理　➖ 结论为不修改

**Critical**（数据丢失 / 损坏）

- ➖ 未发现。随机模型测试（约 200 次保存、约 50 次随机崩溃）下没有串章、孤儿文件或事务残留；
  变异验证（去掉编号变化时的换名）立即失败。

**High**

- ✅ H1 导出：竖长图片只按宽度缩放。Word 中 1:4 的图高 42 cm 超出页面；PDF 中标题被单独留在一页。
  → 统一尺寸规则（正文宽度 × 420 磅，保持比例），预览一致。
- ✅ H2 PDF：过长的 URL / 路径 / 标识符超出页面右边界（Typst 无 overflow-wrap）。
  → 超过 24 字符的连续串允许在任意字符间断行；以排版结果中文字右边界做测试。
- ✅ H3 Word：标题可能孤零零留在页底；多页表格不重复表头；代码块无底色。
- ✅ H4 文件错误信息直接显示操作系统英文原文（如 `Permission denied (os error 13)`），
  只读项目、磁盘已满时用户无法理解发生了什么。
  → Rust 给 io 错误加 `kind`（没有权限 / 只读磁盘 / 磁盘已满 / 找不到 / 被占用），界面说明原因与出路；
  出错位置在项目内部目录时用项目文件夹名。真实只读项目的 Rust 测试验证错误分类且磁盘不变。
- ✅ H5 章节树标题比编号还小、折叠箭头几乎看不见：WebKit 中 `<button>` 不继承字体，
  标题按系统按钮字号显示，而不是 ui-spec 的 14px。

- ✅ H6 已打开项目时"打开"选错文件夹（如父文件夹、content/）或"新建"到非空位置：当前项目先被关闭，
  打开失败后用户被留在欢迎页。→ 失败时重新打开原项目（离开前已保存），以提示说明原因。

- ✅ H7 删除正在编辑的章节后，选中章节仍指向已删除的章节：编辑区变空，之后点"+"新建章节报错。
  根因：受控模式下 `tree.value` 在上层更新 props 前仍是旧树，"选中章节是否还存在"的判断永远为真；
  原有两个测试在更新生效前就断言，没能发现。→ 对照新树判断；并改为选中相邻章节（下一个兄弟 / 上一个 / 父章节），
  可以直接继续写作。
- ✅ H8 关闭原生拖放后（为修复章节拖动），从系统拖入的文件落在编辑器以外时，webview 的默认行为是打开该文件，
  整个应用页面被替换。→ 未被编辑器处理的文件拖放一律取消（编辑器仍可拖入文本文件）。
- ✅ H9 Windows 的 WebView2 默认响应 F5 / Ctrl+R 刷新页面，绕过关闭时的保存流程。→ 屏蔽刷新快捷键。

**Medium**

- ✅ M1 删除确认：按钮是未加样式的系统按钮，"确认删除"没有危险操作的视觉区分，文字字号与界面不一致。
- ✅ M2 编辑器工具栏图标不统一：图片按钮是彩色 emoji，列表圆点过小。→ 统一为单色线条 SVG 图标。
- ✅ M4 预览中点击正文会把该章节设为当前章节，随即滚动到章节开头：阅读位置跳走。
  → 由预览内点击引起的选中不再滚动；从章节树选中仍然滚动定位。
- ✅ M5 切换章节后再回来，编辑器不在原来的位置（光标仍在，但滚动位置是上一个章节遗留的）。
  → 每个章节记住离开时的滚动位置（CodeMirror scrollSnapshot），回来时恢复；没打开过的章节从顶部开始。
  WebKit 实测：离开前 scrollTop 1068，回来后 1068。
- ✅ M6 拖动章节时侧栏不会自动滚动：章节多时无法把章节拖到屏幕外的位置（ui-spec P1）。
  → 指针靠近侧栏上 / 下边缘 40px 内自动滚动，越靠近越快。WebKit 真实拖拽验证。
- ✅ M3 键盘移动章节没有菜单入口，鼠标用户无法发现（拖拽之外的替代方式）。
  → 节点菜单增加上移 / 下移 / 升级 / 降级（显示快捷键，边界处禁用）。

**Polish**

- ✅ P1 靠近窗口底部的章节，节点菜单向下展开会被侧栏裁切，需要滚动才能看到。→ 空间不足时向上展开。
- ✅ P2 导出菜单只能再次点击"导出"关闭。→ 点击别处或 Esc 关闭。
- ✅ P4 窗口标题始终是"Writer"。→ 显示"文档标题 — Writer"（系统标题栏、窗口列表），回到欢迎页时恢复。
- ✅ P5 应用图标仍是 Tauri 默认图标（Dock、任务栏、安装包中可见）；模板遗留的 vite / vue / tauri SVG 未使用。
  → 中性的占位图标（源文件 `src-tauri/icons/app-icon.png`，替换后运行 `npx tauri icon src-tauri/icons/app-icon.png`）；删除未使用资源。
- ✅ P3 窗口最小宽度（720px）下顶栏挤压："保存失败"折成两行、按钮文字竖排。→ 按钮与状态不换行，只有说明文字截断（悬停显示全文）。

## 正文编辑器迁移：CodeMirror → ProseMirror（完成）

正文从 Markdown 源码编辑改为 ProseMirror 结构化编辑（docs/decisions.md 第 2 节）。存储格式、Domain、Application
的保存语义与 Rust 预览 / 导出均未改变：编辑器在 UI 层把 Markdown 解析为 ProseMirror 文档，编辑后再写回 Markdown。

- `ui/editor/schema.ts`：正文结构的权威定义（段落、引用、列表 / 任务列表、代码块、分隔线、GFM 表格、图片、硬换行；
  粗体、斜体、删除线、行内代码、链接）。
- `ui/editor/markdown.ts`：markdown-it（与 pulldown-cmark 相同方言）→ 文档；文档 → Markdown（prosemirror-markdown + 表格、
  任务列表、行首转义、图片地址等补充）。写出前保证每个文本块能被 Markdown 原样读回：强调边界紧挨中文标点时把标点移到标记外，
  仍不能读回时去掉无法表达的格式，文字永远不被破坏。软换行按渲染规则处理（中文之间去掉）。
- `ui/editor/chapter_documents.ts`：应用状态与编辑器状态的适配：每章节一个 EditorState（切换后撤销历史仍在）；
  只有文档改变才生成正文；撤销回载入时的文档时给出原文。
- `ui/editor/commands.ts` / `plugins.ts`：工具栏命令与按钮状态（全部由 EditorState 推导）；快捷键、输入规则、撤销历史、
  表格编辑（Tab / Enter 在单元格间移动）、占位提示、剪贴板（复制出 Markdown、粘贴的纯文本按 Markdown 解析）。
- `ui/editor/image_view.ts`：图片按项目内资源显示（`ProjectSession.assetPath`，规则与 Rust `resolve_image` 一致），
  远程地址与项目外路径不加载，显示占位；链接在编辑器中不可点击打开。
- `ChapterEditor.vue`：整个组件只有一个 EditorView，切换章节换入缓存的 EditorState，不重建视图；每个章节记住滚动位置。
- 删除：CodeMirror 全部依赖（@codemirror/*、@lezer/highlight）、`editor_state.ts`、`markdown_commands.ts` 及其测试。
- 验证：markdown 往返（逐项结构 + 1000 份随机文档：结构与文字不变）、命令、快捷键 / 输入规则、适配器、组件与 App 级测试
  （切换章节写入正确章节、自动保存、插入图片）；npm test、vue-tsc、vite build、build-storybook 通过。
- 已知限制见 docs/known-risks.md 第 7 节。
- 最终验收（Playwright + WebKit 驱动 Storybook 中的 App，与 macOS Tauri webview 同一引擎；真实 Rust 渲染 / 导出）：
  快速切换章节输入不串章、未编辑章节字节不变；长章节切换后滚动 / 光标 / 撤销历史保留；图片与表格前后的光标；
  模拟组字（段首、粗体中、列表项、单元格、空章节，以及组字中切换章节）；Word / WPS / 网页 / Markdown 纯文本粘贴；
  中文强调、表格、任务列表在预览 / Word / PDF 中与编辑器一致。修复：
  - 表格位于章节首尾时方向键无法离开表格（单元格是文本块，gapcursor 把单元格之间当作可放光标的位置）→ 表格行禁用 gapcursor。
  - Word / WPS 表格粘贴后被拆散（单元格内容总是包在 <p> 中）→ 粘贴的单元格内容压成一行。
  - 粘贴网页 / Word 内容会把 data: 图片（base64）、远程图片、本机临时文件写进正文 → 只接受正文中的相对图片引用。
- 未在真实 Tauri 窗口中完成：真实中文输入法（需在真实桌面环境中按手动验收清单确认）。

## 文档样式系统（Document Style System）（历史实现，已移除）

> 本节保留当时的实现与验证记录。共享主题、项目 `style` 与图片布局已被后文的新决策取代，不是后续目标架构。

正文内容与排版分离（docs/decisions.md 第 8 节）：Markdown 只保存内容；整本文档的视觉由主题决定；图片尺寸 / 对齐
作为图片文件（asset）级的布局覆盖按图片文件键保存在 manifest 中。

- Domain `document_style`：`DocumentStyle`（主题 + 调整 + 图片布局）→ `resolveTheme` → `DocumentTheme`（语义参数）。
  内置主题：书籍（默认，与之前的导出排版基本一致）、传统（全宋体、宽松）、技术文档（全黑体、紧凑、图片默认 85%）。
  `WriterDocument.style`；`ProjectSession.selectTheme / overrideStyle / resetStyleOverrides / setImageLayout`。
- 持久化：`writer.json` 可选的 `style`（docs/project-format.md 第 3.1 节），走原有保存事务；默认样式不写出。
- 渲染：`RenderRequest` 携带 `theme` 与 `images`。Rust `render::theme`（数值限制在合法范围）、`render::image_key`；
  预览 HTML 只输出 `data-size` / `data-align`；Word 映射到段落样式（默认、标题 1–9、Title、Quote、Code、TableText、Caption）
  与图片宽度 / 对齐；PDF 映射到 Typst 的 text / par / heading / raw / table / figure 规则。行距语义统一为"相邻基线距离 / 字号"：
  CSS line-height、Word"最小值"行距、Typst 固定 1em 排版框 + leading。
- 编辑器：主题以 CSS 变量作用（与预览共用 `theme_css.ts`，字体栈与 `export::fonts` 同序）；章节标题与正文标题按层级取样式。
  图片布局：插件状态 + 装饰，`ImageLayoutStep` 可撤销；选中图片时工具栏右侧出现"原始 / 小 / 中 / 大 / 通栏、靠左 / 居中 / 靠右"。
- 界面：顶栏"样式"弹出文档样式面板：主题、正文字体 / 字号 / 行距、标题字体 / 一二三级字号、恢复主题默认。
- 验证：domain / 格式 / 会话 / 编辑器 / 组件 / App 级测试；Rust 测试逐项核对 Word 样式 XML 与 Typst 排版结果
  （字号、字体族、实测行距 = 字号 × 行距、图片宽度与左右位置）；TS 与 Rust 共享默认主题与图片文件键用例；
  WebKit（Playwright）中查看 Storybook：布局按钮、撤销、主题变量生效。


## 界面整体重做（UI / UX 设计准则落地）

按 docs/ui-design-principles.md 重做界面层；领域模型、文档格式、章节移动规则、导出语义均未改变。

- 界面 token：`ui/tokens.css`（颜色层级、字号、间距、控件高度、圆角、阴影、动画时长）；`ui/base.css` 为应用与 Storybook 共用的基础样式。
  共用组件 `ui/common/`：`Icon`（统一线条图标）、`PopupMenu`（键盘导航、翻转定位、焦点归还）、`Toast`（浮层提示，不挤压布局）。
- 工作区（文档名与保存状态后来移到工具栏开头，快捷键改为 ⇧⌘N / ⇧⌘O，见下一节）：侧栏 = 文档名（文档菜单：重命名 / 新建 / 打开，⌘N / ⌘O）+ 保存状态 + 章节树，可拖动调整宽度（180–480px，双击恢复，
  键盘可调）；正文区只有一行顶栏：左侧正文工具（由编辑器提供状态与命令），右侧"样式 / 预览 / 导出"文字按钮；
  章节标题随正文滚动；正文滚动后顶栏下方才出现分隔线；预览为开关按钮，Esc 回到编辑。
- 章节树（ui-spec 语义不变）：旋转的展开箭头；插入线从落点层级的编号处开始，并显示松手后的新编号（Application `moveChapterTo`
  在树副本上执行同一次移动得到）；无效落点不接受放下（系统"不可放下"光标）；拖到树下方空白 = 成为最后一个一级章节；
  拖入折叠章节停留 600ms 自动展开；源章节及其子章节一起变淡；移动后新位置短暂高亮；右键菜单与 Shift+F10；
  删除确认改为模态对话框（焦点在"取消"，Tab 循环，Esc 取消，关闭后焦点回到章节树）；操作失败的说明浮在侧栏底部。
- 键盘：WebKit 默认不让按钮参与 Tab，界面主要按钮显式可聚焦；Tab 顺序：文档名 → 文档菜单 → 新建章节 → 章节树 → 侧栏宽度 →
  样式 / 预览 / 导出 → 正文。
- 验证：全部测试（按新结构更新了选择器与少量断言）；WebKit（Playwright）驱动 Storybook 截图检查默认、hover、选中、
  键盘焦点、菜单、右键菜单、拖拽 before / inside / after / 树尾 / 无效落点、删除对话框、重命名、样式面板、预览、导出提示、
  保存失败、空文档、深层级与长标题、图片选中（窄 / 宽）、720×480 最小窗口；1050 章节文档中拖拽反馈每次约 18ms。

## 以 macOS HIG 为基准的界面调整

领域模型、文档格式、章节移动规则、导出语义、组件规格均未改变；改变的是命令的入口与窗口结构。

- 窗口：macOS 上标题栏与工具栏合一（`titleBarStyle: Overlay`），侧栏延伸到窗口顶部，窗口按钮在侧栏左上角；
  工具栏空白处与欢迎页背景可以拖动窗口（`data-tauri-drag-region`）。其他平台保持系统标题栏（`DesktopShell.windowStyle`）。
- 菜单栏（`ui/app_shell/app_menu.ts`）：文件 / 编辑 / 格式 / 插入 / 表格 / 章节 / 显示 / 窗口，全部命令与快捷键在这里；
  可用状态随焦点区域变化（正文 / 章节树 / 输入框），同一按键在不同位置不会有两种含义。它同时是工作区快捷键的唯一来源：
  没有系统菜单栏的平台按同一份菜单响应按键。
  Windows 上同一份菜单显示为标题栏下方的系统菜单栏（2026-10-05 产品负责人确认）：没有应用菜单与“窗口”菜单，
  “关于”在“帮助”中；快捷键只显示在菜单文字右侧，按键仍由工作区响应（WebView2 获得焦点时系统菜单收不到按键）。
- 右键菜单与按钮菜单在桌面环境中是系统菜单（`ui/common/use_menu.ts`、`infrastructure/tauri_menu.ts`），
  没有系统菜单时（Storybook、测试）由 `PopupMenu` 绘制；网页默认的右键菜单（重新载入等）不再出现。
- 工具栏只保留高频操作：插入表格 / 图片、全文预览、文档样式、导出；粗体、斜体、列表、引用、代码块移到格式菜单、
  正文右键菜单与快捷键。
- 快捷键（`ui/common/shortcuts.ts` 是唯一定义处）：Writer 自己的快捷键只用"⌘ + 一个键"——⌘S / ⌘Z；
  例外：新建 / 打开文档用 ⇧⌘N / ⇧⌘O（文档级、低频，⌘N 留给章节树中的新建章节）；
  格式与插入菜单每一项都有快捷键：⌘B 粗体 / ⌘I 斜体 / ⌘D 删除线 / ⌘E 行内代码 / ⌘7 有序列表 / ⌘8 无序列表 / ⌘9 引用 /
  ⌘0 代码块 / ⌘] ⌘[ 缩进 / ⌘L 文档样式 / ⌘T 表格 / ⌘G 图片；⌘Y 显示 / 隐藏侧栏；⌘/（或 Shift+F10）打开操作菜单（正文中在光标处，章节树中是焦点章节的菜单）；章节树中 ⌘⌫ 请求删除；
  ⌘J 在章节树与正文之间切换，章节树中 ⌘N 新建 / ⌘↩ 重命名 / ⌘ + 方向键移动 / h j k l 浏览（后续修订）；
  ⌘W、⌘X / ⌘C / ⌘V / ⌘A 由系统菜单项提供。
  没有自然单键的命令不设快捷键：重做、新建（子）章节、上移 / 下移 / 升级 / 降级、全文预览。
- 文档名移到工具栏开头：点击打开文档菜单（重命名 / 新建 / 打开 / 在访达中显示），重命名在原处进行。
  自动保存正常时不显示"已保存 / 未保存"；保存失败时文档名旁出现"保存失败 · 重试"，并以提示条给出原因。
- 侧栏可以隐藏（显示菜单、工具栏按钮、把分隔线拖到最窄处以外），偏好按本机保存。
- 正文：右键菜单按点击处给出操作（图片：尺寸 / 对齐；表格：插入 / 删除行列、删除表格；文字：格式与结构）；
  选中图片时布局按钮浮在图片上方，不再替换整条工具栏；正文未获得焦点时第一次点击图片即选中它。
- 章节树：双击标题重命名；⌘⌫（Windows：Ctrl+Delete）删除，空章节直接删除、其余先确认（ui-spec §23），单独的 Delete 仍不删除；
  同一父章节下的编号等宽，标题左端对齐。
- 验证：全部测试；Chrome 与 WebKit（Playwright）驱动 Storybook 检查窗口两种样式、菜单、右键菜单、图片布局、侧栏隐藏、
  重命名、Tab 顺序、最小窗口与大文档；真实 Tauri 窗口中检查了合一标题栏与窗口按钮的位置。
  真实 Writer Dev 窗口（测试项目）中逐项操作过系统菜单栏、系统右键菜单与快捷键（见手动验收清单第 11 项）：
  发现并修复了"右键章节时应用卡死"（弹出菜单与菜单栏更新同时占用 Tauri 菜单资源表）与"从菜单栏打开样式面板后焦点不回正文"。
- 开发版与正式版隔离：开发构建是 Writer Dev（`io.github.tanjiasong006.writer.dev`），上次打开的项目与界面偏好保存在各自配置目录的
  `app-state.json`（正式版第一次运行时迁移原 localStorage 中的记录）；项目锁仍按项目路径生效。见 AGENTS.md"开发版与用户数据"。
- 已知的小问题：选中图片时浮在图片上方的布局按钮会盖住上一段的末行文字；系统自动加入的菜单项（Close All、AutoFill、
  Start Dictation、Emoji & Symbols）在未打包的开发版中显示为英文，正式包需要在 Info.plist 中声明中文本地化后再确认。

### 项目资源释放与损坏图片预览修复

- 放弃会话后禁止新的保存与排队保存启动；释放项目锁前等待已经开始的保存结束，
  避免保存失败确认期间自动重试与释放锁交错。
- Rust 打开成功但前端数据校验失败时，先请求关闭后端项目再返回校验错误；
  后端打开直接失败时不额外关闭，释放失败时保留原始校验错误。
- 全文预览中的图片加载 / 解码失败时，使用现有的“图片无法显示”文字占位，保留图注与章节选择；
  HTML 更新后重新加载图片。新增 `DocumentPreview/BrokenImages` Story，包含正常、损坏、行内与无替代文字的图片。
- 验证：新增测试先复现失败再修复；Vitest、类型检查、应用与 Storybook 构建通过；
  Chrome 中目视检查了正常图片、损坏图片占位、行内正文及图注。

## 导出能力边界与排版职责

- Writer 负责组织和编辑结构化文档与内容，并生成整洁、可靠的交付文档，不负责后续精细排版。
- 编辑阶段提供默认美观、易读的内容展示；Word 输出供他人继续编辑；PDF 用于直接阅读、打印与正式交付。
  三者保证内容与结构一致，不要求页面视觉一致。
- 解除现有主题同时控制编辑界面、Word、PDF 的绑定。“主题”改为应用级编辑环境偏好，
  不随项目保存、不影响导出；输出排版设置集中在排版阶段，Word 使用规范的默认输出样式，
  PDF 采用文档级排版配置与统一自动排版规则。
- 不提供针对单张图片、单个段落等内容元素的手工排版或局部布局覆盖；最终 PDF 可以先在外部阅读器中检查，
  移除应用内预览，不新增分页预览。
- 图片大小、对齐、位置等信息不属于文档元数据，也不另设局部布局存储；图片引用与图注继续作为内容保存。
- 直接移除 `DocumentStyle`、`WriterDocument.style` 与 `writer.json.style`（含 `theme / overrides / images`）。
  旧字段读取忽略，打开不写盘，正常保存不再写出；不迁移到应用偏好或 PDF 配置。
- 移除会话中的样式修改用例、图片布局插件 / 按钮 / 菜单与布局撤销；保留图片内容编辑、图注与资源安全解析。
- 编辑环境使用自己的默认主题和应用级偏好；渲染请求不再从文档取得共享主题或图片布局映射。
  Word 与 PDF 分别取得输出参数，共享内容解析。
- 后续先落实旧样式移除，再设计编辑环境设置与 PDF 文档级配置。PDF 新字段及存储结构尚未确定，
  不沿用旧 `style`，实施前更新项目格式契约。
- 已确认移除全文 HTML 预览及其连续阅读、章节点击 / 滚动同步；不在编辑器中新增替代视图。
  删除预览组件、模式 / 刷新状态、菜单 / 按钮、端口、Tauri command、HTML 渲染及相关测试 / Story。
  保留 Word / PDF 使用的内容解析、IR、请求组装与安全资源解析。
- `RenderRequest` 去掉 `theme / images`，Word / PDF 使用各自默认输出参数；
  取消 HTML 预览默认参数过渡方案，不等待新主题或 PDF 配置。

### 实施顺序

1. 先移除预览，独立提交：清理预览调用链与界面状态，保留导出内容解析及当前导出参数，
   不在这一步顺带删除旧样式。Workspace 的预览模式未持久化，无需设计旧应用状态的模式迁移。
2. 再移除旧样式，独立提交：移除文档 `style`、共享主题输入和图片局部布局，迁出必要的资源路径解析，
   让编辑、Word、PDF 分别使用默认参数，并落实旧字段忽略 / 不写出的读写规则。
3. 预览移除后尽早评估“导出后打开文件”的低成本流程，关注跨章节通读摩擦；
   临时生成方案也可比较，但两者都是独立产品选项，不是前两步的前置条件。

每步运行相关检查并更新文档状态。跨实现内容测试作为一致性验证落实，不引入产品运行时跨语言调用。
本次保留 Rust `render`、`RenderRequest` 等名称；重命名若有必要，另作独立修改。

### 实施记录

- 第 1 步（移除预览）完成：删除 `ui/preview/`（组件、测试、Story）、`use_preview.ts`、`DocumentOutput.renderPreview`
  与 `previewDocument`、Tauri `render_preview` command、`render::html` 及仅供其使用的辅助函数；
  工作区不再有编辑 / 预览模式、预览按钮、“显示 → 全文预览”菜单项与预览中的 Esc 处理，`preview` 图标删除。
  大文档性能测试只保留解析、Word、PDF 的测量。代码与测试注释中“与预览一致”的说法已改为与导出的判断一致。
- 第 2 步（移除旧样式）完成：
  - 删除 Domain `document_style`、`WriterDocument.style` / `setStyle`、manifest 的样式解析与生成、
    会话中的样式用例；旧项目的 `style` 读取忽略、打开不写盘、正常保存不再写出（TS 与 Rust 两侧均有测试）。
  - TS `imageKey` 只剩资源显示路径解析的用途，其解码、规范化与越界拒绝逻辑移入
    `project_format.resolveAssetReference`，原共享用例转入该函数的测试；`fixtures/image-keys.json`、
    `fixtures/default-theme.json` 与 Rust `render::image_key` 一并删除，Rust `resolve_image` 保留。
  - 编辑器：删除 `image_layout.ts`、`ImageLayoutControls.vue`、布局菜单、`changeFigureLayout`、布局 props / emits
    与相关 Story / 测试；选中图片的右键菜单只有剪切 / 拷贝。展示参数改为编辑器自己的 `editor_theme.ts`
    （默认值与旧 book 主题相同，不再要求与 Rust 字体候选同序）。工作区删除样式面板、“格式 → 文档样式…”与 ⌘L。
  - 导出：`RenderRequest` 只有标题与章节；`render::theme` 移为 `export::theme`（只有输出参数，不反序列化），
    Word / PDF 各自取 `Theme::default()`。图片按统一规则计算尺寸：保持比例、不放大，不超过所在容器宽度
    （正文、列表 / 引用缩进后、表格单元格）与完整正文区高度；独立图片居中，为图注及间距预留高度，
    Word 以 keepNext 与图注保持同页，PDF figure 不拆分、放不下时整体移到下一页。DPI 当时按固定 96 换算，后改为读取元数据（2026-10-04，decisions 第 8 节）。
  - Word 仍使用内置样式：正文 Normal（文档默认），标题 Heading 1–9（带大纲级别），图注 Caption；测试覆盖。
- 编辑与输出的内容契约测试完成：`src-tauri/fixtures/markdown/` 下 9 个共享用例（图片 / 图注、表格、列表、
  标题、强调、中文标点边界、原始 HTML、换行、引用 / 代码 / 分隔线），前端 `markdown_contract.test.ts` 验证
  原文语义、golden 与往返，Rust `render::contract_tests` 验证原文与 golden 的 IR；默认测试运行只读
  （`update: "none"`，缺失 golden 失败，已验证）。编写用例时发现并修复一处不一致：同种强调嵌套在自身之中
  （`**“甲”**乙**“丙”**`）时编辑器会在内层结束处丢掉外层粗体，而导出显示为整段粗体；
  现在编辑器解析时合并同种嵌套标记（`markdown.ts` 的 `writer_nested_marks`）。
- 评审修复（图片尺寸规则）：
  - PDF 表格中的竖长图超出正文区（两列表格中 200×4000 图片底边 793pt，正文区底边 771pt）：
    行内图片高度上限原为整页正文高度，未扣除重复的表头与单元格内边距。现在正文行中图片的上限为
    正文区减去排版时测得的表头高度（`measure`）与内边距；表头中的图片不超过正文区高度的四分之一。
  - PDF 图注估算偏小（四组 30 个 W 的图注估为 2 行、实际 4 行，末行进入页码区）：改为排版时测量图注高度。
  - Word 无法测量，同类问题改用保守上限：`images::text_height_pt` 按每字 1em 与单词贪心折行估计图注与表头高度，
    正文行中的图片同样扣除表头与段落间距。
  - 先补测试复现（PDF 表格长图、段落长图、长图注；Word 表格长图、长图注；PDF 表头图片上限），修复后全部通过。
- 第二轮评审修复：
  - 单独测量的表头与最终表格列宽不同（自动列宽受正文内容影响），折行不同导致图片底边 782.8pt 超出正文区：
    PDF 中含图片的表格改为等宽列，表头在 `layout` 取得的实际容器宽度下按同样的列宽测量。
    没有图片的表格仍按内容分配列宽。
  - 图片宽度下限 1pt 让极窄长图（10×10000）按比例恢复出超限的高度：下限改为 0pt，高度上限优先。
  - 新增测试：表头折行与正文列宽相互影响（正文与引用中各一例）、极窄长图（独立与行内）、含图片的长表格跨页且表头重复。

### 后续实现验收

- TS 与 Rust 读写两侧都不再把旧 `style` 作为有效数据；测试覆盖旧字段读取忽略、打开不写盘、保存不再写出。
- 删除旧字段后，标题、章节、正文、图片引用、图注与资源保持完整，保存事务与恢复规则继续有效。
- 编辑环境主题变化不产生文档 dirty 或正文撤销记录，不改变 Word / PDF 输出参数。
- 引入 PDF 配置时验证项目 dirty、内容与配置的统一保存快照、保存中继续修改及配置修改不重写正文。
- 图片尺寸测试覆盖完整正文区宽高限制、图注空间与行内容器限制，不因落在页底而缩小图片；
  Word 验证内置样式、大纲与可继续编辑的结构。
- 移除布局键前保留 TS 图片显示路径解析能力及 Rust `resolve_image`，拆除共享主题 fixture 的一致性约束。
- 以各自默认参数验证 Word 与 PDF，移除预览入口及专用状态 / 调用链和旧验收项。
  内容与结构一致，不要求页面视觉一致。
- 全文连续阅读、章节点击选择及滚动同步一并取消；
  更新 README、decisions、project-format、known-risks、UI 准则、组件 CONTRACT 与本计划的现行预览引用、
  `src/ui/chapter_tree/ui-spec.md` 第 28 节、菜单 / 快捷键 / Story 和手动验收项。
  历史记录可保留但标明已被取代，不自动承诺替代入口。
- 删除 `render::html` 时同步清理 `src-tauri/src/export/mod.rs` 中大文档性能测试的 `html::render` 调用、
  HTML 输出与仅供预览的测量，保留解析、Word、PDF 的性能测量；检查 ignored 测试仍能编译。
  清理 `ChapterEditor.vue` 等代码中“与全文预览一致”的旧注释，避免保留共享视觉约束。
- 新增共享 Markdown 语义 fixture：编辑器往返测试、Rust 原文与实际编辑器序列化结果的 IR 测试、
  Application 章节顺序 / 标题 / 编号测试及 Word / PDF 输出测试共同承担一致性验证。
  不以人工 HTML 预览替代这些测试，详见 decisions 第 8 节。
- 跨语言流程使用 `src-tauri/fixtures/` 下的入库 golden：Vitest 用 `toMatchFileSnapshot` 比较实际编辑器输出，
  自带 `-u` 更新 `.serialized.md`；Rust 分别验证原文与 golden。预期语义为中立 JSON 块树，双方测试各自投影，
  用例组织与语义格式见 decisions 第 8 节。更新后审查差异并通过两侧测试，不另写更新脚本或开关。
  默认测试运行只读，使用 `update: 'none'` 或等效选项保证缺失 golden 时失败，不隐式创建文件。
- 编辑环境设计时落实行内长图的展示高度上限并更新 Story，验证表格单元格中图片的比例与可读性。
- 调整旧 Story / 测试并补充默认图片展示、图片选择与删除、编辑环境偏好等实际新增或修改行为的覆盖；
  UI 修改按 `docs/ui-design-principles.md` 验收。
- 代码落地后逐处清理 decisions、project-format、known-risks 与模块 CONTRACT 中已完成事项的过渡说明，
  同步本计划状态；尚未实施的编辑环境设置与 PDF 配置继续明确标为待设计 / 待实施。
  清理预览移除的过渡说明，不保留“定位待确认”或“HTML 临时默认参数”的待办。

长期约束见 `docs/decisions.md` 第 5、6、8 节；之前“文档样式系统”的记录描述现有实现，不能视为新方向已经完成。

## 全文阅读

- `ui/reader/DocumentReader.vue`：连续显示所有章节；`chapter_body.ts` 用编辑器的解析与 schema 生成只读 DOM
  （图片与编辑器相同的结构，`image_view.staticImageDOM`）；只有正文变化的章节重新生成。
- 正文展示样式从 `ChapterEditor.vue` 移到共享的 `ui/editor/document_body.css`，编辑器只保留编辑才有的状态
  （光标、选区、占位、表格格线提示、选中图片、图注文本框）。两处滚动区都 `scrollbar-gutter: stable`，
  切换时版心不左右移动。
- 位置对齐：`ui/editor/block_position.ts`（视口顶端所在的顶层块与偏移）；编辑器提供 `readingPosition` /
  `revealPosition`，阅读区提供 `position()` 与 `initialPosition`。在 Storybook 中核对过同一正文两处的块位置一致。
- 工作区：阅读区盖在编辑器上，编辑器 `inert`；插入按钮在阅读中隐藏；菜单 `view:reader`（勾选）与 ⇧⌘R；
  删除全部章节时自动结束阅读。
- 测试：`block_position`、`chapter_body`、`DocumentReader`（滚动联动、定位、Esc / Enter、局部更新）、
  `app_menu` 与 `Workspace`（开关、撤销历史保留、章节树 Enter / ⌘J、空文档）。Story：`UI/Reader/DocumentReader`。
- 未在 Tauri（WKWebView）窗口中目视检查；大文档打开耗时只在 Chrome 中测过。

### PDF 图片体积与开发版导出性能（2026-09-30）

- Word / PDF 共用图片准备，不再将普通 JPEG 转为 PNG：尺寸合适的 JPEG 原样嵌入；超大 JPEG 缩小后以质量 90
  编码为 JPEG。PNG / GIF 与带旋转元数据的 JPEG 沿用原 PNG 路径，保持既有显示尺寸与方向。
- DOCX 库默认仅按 `.png` 存放图片；Word 导出在打包时把 JPEG 以 `.jpeg` 存放，并同步修正文档内关系，
  使用库已声明的 `image/jpeg` 内容类型。PNG 与其他部件仍由库打包，重复图片继续由库去重。
- 开发构建仅对 `image`、`zune-jpeg`、`typst-layout`、`typst-library` 开启 `opt-level = 2`，
  Writer 自身仍使用默认开发配置，release 配置不变。第一次切换配置需要重新编译相关依赖。
- 新增忽略运行的分阶段基准 `measure_image_pdf_export`（24 张 JPEG，源图片约 29 MB，60 页）；
  本机 PDF 导出阶段总耗时约 17.2 s → 5.3 s：图片准备 6.49 s → 2.03 s、排版 10.45 s → 3.03 s、
  PDF 编码 0.29 s → 0.28 s；两次输出均为 29,035,461 字节、60 页。
  测量不计测试图片生成与字体库预热，不等同于真实文档的完整操作耗时。
- 同一基准增加 Word 导出：保留 JPEG 后，约 69.4 MB / 11.5 s → 29.1 MB / 2.5 s。
  Word 回归测试校验 JPEG 原字节、扩展名、图片关系、内容类型、重复图片去重与重新读取；混合 PNG / JPEG
  的既有图片测试增加缩小后 JPEG 的尺寸检查，手动样例也覆盖两种格式。
- JPEG 原样嵌入、PNG / GIF、大图缩小、旋转元数据与损坏图片有回归测试；
  既有图片分页、图注、表头与 Word 输出测试继续覆盖导出质量。

### PDF 单次导出图片复用与体积来源验证（2026-09-30）

- PDF 按安全解析后的文件路径复用已准备的图片字节、尺寸与虚拟路径，每次引用仍先做路径安全检查。
  显示尺寸、图注和容器高度限制继续按每次出现的位置计算；缓存只属于一次导出，下一次重新读取文件。
- 新增回归测试：不同引用写法复用同一文件、不同容器的尺寸独立、下次导出读取更新 / 损坏的文件；
  JPEG / PNG 在独立图片、引用与表格中，与三个分别准备的相同图片文件对照，文字和图片坐标、尺寸、分页一致。
- 新增忽略运行的 `measure_pdf_image_formats`：纯文字、JPEG、PNG、混合与重复图片，打印 Word / PDF
  体积、Word 媒体字节与 PDF 准备 / 排版 / 编码耗时；可用 `WRITER_SAMPLE_DIR=<测试目录>` 保留 PDF。
- 本机开发构建，单张 1200×800 JPEG 重复 24 次：准备时间约 1.97 s → 0.083 s，
  排版约 0.136 s → 0.050 s；准备的压缩数据 28,875,480 → 1,203,145 字节。
  输出前后均为 1,261,660 字节、16 页，底层已经把相同图片只嵌入一次，此改动主要减少准备耗时与中间数据。
- 合成渐变 PNG（六个文件内容相同）：Word 56,338 字节，PDF 491,230 字节。
  用 PyMuPDF 检查，两个格式均只嵌入一份图片；PNG 原文件 17,348 字节，PDF 图片流 455,200 字节，
  PDF 字体程序解压后总计 32,996 字节。该样例的体积差异主要来自非 JPEG 图片重新编码，
  不把这一比例推广到真实截图或用户文档。纯 JPEG 样例 Word 7,259,226 / PDF 7,254,681 字节。
- 导出相关测试通过（53 项，另加 JPEG / PNG 容器排版对照测试），clippy 无警告；
  PyMuPDF 解析全部测试 PDF 并检查图片页面边界，目视核对各类样例首页与重复图片尾页。
  未调整图片清晰度、输出排版、字体或无障碍信息；PNG 无损编码优化仍待后续评估。

### PDF PNG 无损编码优化（2026-09-30）

- Typst 0.15.1 通过 krilla `Image::from_custom` 输出 PNG：旧实现直接对解码后的通道做 DEFLATE，
  没有逐行预测，部分 PNG 因此显著膨胀。通过 `[patch.crates-io]` 固定本地 `krilla 0.8.2`，
  补丁范围、来源、许可证、测试与升级方式见 `src-tauri/vendor/krilla/WRITER-PATCH.md`。
- 8-bit RGB / 灰度通道及对应 alpha 通道复用现有 `png` crate 的自适应过滤，以 DEFLATE level 3
  编码后取 IDAT，用标准 PDF `FlateDecode` + `Predictor 15` 输出；保留 ICC、色彩空间、软遮罩、
  图片尺寸与全部页面内容。JPEG 和其他入口沿用既有路径，不引入有损压缩或额外缩小。
- 开发构建增加 `krilla` / `png` 的 `opt-level = 2`，release 配置不变。
- 匿名测试项目副本（19 章、52 个独立图片、82 页）：PDF 35,942,921 → 28,315,867 字节，减少约 21.2%；
  PNG 图片流 25,178,275 → 17,540,582 字节。Word 仍约 28.68 MB。
  相同依赖优化等级的第二次导出单次测量，PDF 编码约 2.27 s → 2.01 s、阶段总计约 6.67 s → 6.40 s；
  不含字体初始化、写盘和界面操作，耗时收益较小，不作为跨机器承诺。
  DEFLATE level 6 的候选输出略小（约 27.84 MB），但编码更慢，因此采用 level 3。
- 独立 PyMuPDF 检查：82 页逐页以 0.7 倍渲染，优化前后像素完全一致；全部解码图片与 alpha
  遮罩、文字、书签、页尺寸一致。14 种合成 PNG（灰度、RGB、透明、palette、interlaced、ICC、
  1-bit 与 16-bit 来源）也逐页渲染与解码像素一致；代表页面已目视核对。
- 新增 PNG 体积与透明软遮罩回归；补丁测试验证过滤通道通过 PNG decoder 精确还原、
  普通 / ASCII PDF 的 DecodeParms 顺序、异常输入。Rust 测试 113 项通过、8 项忽略，clippy 无警告。
  测试项目的原目录未修改，实际导出与验证都在临时副本中完成。

## PDF 默认样式与排版配置（完成）

设计与约束见 `docs/pdf-layout.md`，按其第 6 节顺序分步实施：默认样式 → 文档信息 → 排版配置存储与会话 → 排版设置界面。

### 第 1 步：默认样式（完成，2026-09-30）

- `Theme::pdf()`：正文行距 1.75、段间不留空；标题 18 / 15 / 13 / 12pt（新增第 4 级，Word 的 `Theme::default()`
  第 4 级沿用第 3 级取值，Word 输出不变）；封面标题 26pt；代码 9.5pt；表格 10.5pt。
- `pdf.rs`：有标题时生成封面；有章节时生成两级目录（罗马数字页码），正文页码从 1 开始；一级章节另起一页、上方留白 36pt；
  页眉（文档标题 + 当前一级章节，章节首页不显示）；9pt 页码；首行缩进 2 字符（列表、引用、表格、图注、目录不缩进）；
  三线表（顶底 1pt、表头下 0.5pt，随表头跨页重复）；行内代码浅灰底；分隔线居中 30%；链接深蓝。
- 性能：页眉用原生 `before` / `after` 选择器查找前后章节。最初在脚本中逐页遍历全部章节，
  1000 章（2036 页）排版从 5.0 s 变为 35.5 s；改为选择器后为 1.6 s。
- 验证：新增封面 / 目录 / 章节分页 / 页眉、无标题无封面、首行缩进测试；原有测试按新增目录页与页码重新计数更新预期。
  Rust 测试全部通过，clippy 无警告；示例 PDF 逐页渲染目视检查。

### 第 2 步：文档信息（完成，2026-10-01）

- Domain：`WriterDocument` 增加 `subtitle`、`author`（空串表示没有）与 `setDocumentInfo`；
  `createDocument` / `emptyDocument` 的签名不变，得到的文档没有副标题与作者，加载时再设置。
- 格式：manifest 可选字段 `subtitle`、`author`，空串不写出；存在但不是字符串时拒绝打开（`subtitle-invalid` /
  `author-invalid`，界面显示 writer.json 损坏）。Rust 存储层原样传递 manifest，无需改动。
- 会话：`setDocumentInfo` 推进 revision、产生 dirty，保存不携带正文；相同信息不产生修改。
- 输出：`RenderRequest` 增加 `subtitle`、`author`（Rust 侧缺省为空）。PDF 封面在标题与细线之下依次显示副标题（16pt）
  与作者（12pt），三者都为空时没有封面；PDF 元数据写入标题与作者。Word 在标题后输出 `Subtitle`、`Author` 样式段落，
  并整体生成 `docProps/core.xml`（标题、作者），不再写出 docx-rs 默认的作者 "unknown"。
- 界面：文档名菜单与菜单栏"文件"中的"文档信息…"打开模态对话框（`DocumentInfoDialog`，外观与删除确认一致）：
  标题、副标题、作者三栏，Enter 完成、Esc 取消、Tab 在对话框内循环，点击遮罩不关闭；空标题保留原标题；
  关闭后焦点回到打开前的位置。新增 Story（空、已填写、超长）。
- 验证：Domain、格式、存储适配、会话、输出请求、Workspace（菜单入口、Esc / 完成、焦点、Tab 循环）测试；
  Rust 新增 PDF 封面 / 元数据与 Word 段落 / 文档属性测试。Rust 测试与 clippy、Vitest、类型检查全部通过。
  Storybook 中目视检查了浅色与深色外观；示例 PDF 封面渲染检查。

### 第 3 步：排版配置的存储、会话与输出（完成，2026-10-01）

- Domain `pdf_layout`：配置类型、默认值、可选值、`resolvePdfLayout`、`setPdfLayoutOption`（改回默认值时删除该项）。
  默认值与 Rust 共享 `fixtures/pdf_layout_default.json`，两侧测试都对照它。
- 存储端口与会话改用 `ProjectState { document, pdfLayout }`：打开、新建、保存都携带配置；会话的 `setPdfLayout`
  推进 revision、产生 dirty，与文档在同一快照中保存，不携带正文；保存期间的配置修改留到下一次保存。
  测试用内存存储保留 `seed` / `committed`（文档），另加 `committedPdfLayout`。
- manifest `pdf`：按固定顺序只写出合法的改动项；读取时不是对象则整体忽略，非法或未知项逐项忽略，不阻止打开。
- 导出：`exportDocument` 在同一次操作中取文档与配置，PDF 命令携带合并后的完整配置（`layout`），Word 不携带。
- Rust `export::pdf_layout`：反序列化（取值不在选项内时拒绝）、页面尺寸（A4 / B5 / A5 / Letter，边距 18 / 25 / 32mm，
  双面内侧 +5mm、外侧 −5mm）与输出参数（字体族、按正文字号缩放的各元素字号、行距、段距）。`pdf.rs` 的正文区尺寸
  由页面设置计算（取代 A4 常量）；封面开关（关闭时文档信息放在首页顶部，没有目录时第一章紧接其后）、目录开关与深度、
  一级章节另起一页（改为按章节输出换页）、章节编号（1 / 第 1 章 / 不显示）、页眉（无 / 标题 / 标题 + 章节；双面时
  左页标题、右页章节）、页码（1 / 第 1 页 / 1 / N；双面时在外侧）、表格（三线表 / 网格）。双面装订时目录、正文与每章
  从右页开始，插入的空白页用前后标记识别，不显示页眉页码。
- 验证：Domain、格式、存储适配、会话、导出请求与 Workspace 测试；Rust 新增配置反序列化 / 页面 / 输出参数测试与
  每个配置项的排版测试（纸张与双面边距、空白页、字体字号行距段距、无封面、目录、章节编号、页眉页码、网格表）。
  示例 PDF 以非默认配置（B5、双面、无封面、第 1 章、网格表、1 / N）渲染检查。1000 章（2036 页）排版 1.8 s。
  `write_sample_pdf` 支持 `WRITER_SAMPLE_LAYOUT=<JSON>` 覆盖部分配置。

### 第 4 步：排版设置界面（完成，2026-10-01）

- `PdfLayoutDialog`：页面 / 文字 / 结构三组选项（分段控件与复选框，相关项同行：正文字体与字号、封面与目录及层级），
  左侧 `PdfLayoutSchematic` 页面示意随草稿即时变化。修改作用于草稿，"导出…" / "完成"提交，"取消" / Esc 放弃，
  "恢复默认"清空改动（没有改动时不可用）。模态，Tab 在对话框内循环，焦点不在按钮上时 Enter 等同主按钮，
  关闭后焦点回到打开前的位置。窗口较矮时只有选项区滚动。
- 入口：工具栏导出菜单与菜单栏的"导出为 PDF…"先打开设置（主按钮"导出…"，提交后选择保存位置并导出）；
  菜单栏新增"文件 → PDF 排版设置…"（主按钮"完成"，只保存设置）。
- 新增通用 `SegmentedControl`（单选按钮组：整组一个 Tab 位置，方向键移动并选中，Home / End）与 token
  `--color-control-selected`（深色外观下选中段可辨）。
- 验证：分段控件、对话框（草稿、改回默认值不记录、恢复默认、Esc / Enter / Tab）与 Workspace（导出流程、取消、
  菜单入口只保存、dirty 与保存）测试；新增 Story（分段控件三种状态；对话框默认 / 改过多项 / Letter 窄边距）。
  Storybook 中目视检查了浅色与深色外观、示意随设置的变化；默认 800px 高的窗口中对话框不需要滚动（自然高度约 640px）。

### 排版设置中的 PDF 样张（完成，2026-10-01）

- 以真实排版的样张取代 `PdfLayoutSchematic` 页面示意。Rust `pdf::preview` 与导出共用排版，前 8 页用 `typst-svg`
  渲染（随 Typst 已在依赖树中）；command `preview_pdf` 不写文件。Application `createPdfPreview` 在打开设置时捕获
  文档开头（`buildPdfSample`：前两个一级章节，正文上限 12000 字）。
- `PdfLayoutPreview`：设置变化立即重排，进行中的修改合并为完成后的一次重排；保留旧页面，超过 300ms 才淡出；
  首次结果前是按纸张比例的空白页（稍后显示"正在排版…"），失败时在空白页上说明。对话框加宽到 720px，
  样张不参与对话框高度，单独滚动。
- 耗时（约 2.4 万字样张，8 页 SVG 共约 1 MB）：release 约 35 ms，开发构建约 0.6 s。
- 验证：Rust 样张页数与纸张尺寸、样张截取、Application / Infrastructure、样张组件（空白页、合并重排、失败）
  与 Workspace 测试；新增 Story（样张四种状态，对话框使用近似页面）。Storybook 中目视检查了对话框与失败状态；
  真实 Tauri 窗口中的样张未目视检查。
- 全尺寸查看（`PdfPageViewer`）：点击样张中的一页打开，铺满窗口，各页按实际尺寸竖向排列（宽度取 SVG 的磅值，
  窗口较窄时缩小），定位到点击的页；Esc、点击页面以外或关闭按钮回到设置。查看层打开期间排版设置不处理按键
  （Esc 只关闭查看层，Enter 不提交）。不重新排版，直接放大同一份 SVG。样张页按 SVG 尺寸保留比例，加载时不跳动。
  验证：查看层尺寸、定位、关闭方式与按键隔离测试；新增 Story；Storybook 中目视检查打开、定位到第 2 页、Esc 关闭。

## 章节交叉引用

产品决策见 `docs/decisions.md` 第 9 节，地址格式见 `docs/project-format.md` 第 4.1 节。每一步单独完成并测试。

1. 格式与解析：共享 fixture 覆盖有效、失效、格式错误的引用；编辑器 Markdown 转换与 Rust 内容中间模型识别引用并原样写回。
2. 编辑器展示：引用节点，文字按当前章节树生成，结构变化后立即更新且不产生 dirty；失效样式；全文阅读同样。
3. 导出：Word / PDF 生成引用文字并在文档内跳转，PDF 跟随章节编号样式；失效引用列入导出报告。
4. 插入与操作：选择浮层、⌘K、右键菜单、⌘ 单击、跳转与返回。
5. “更新交叉引用”与删除章节时的被引用提示。

### 第 1 步：格式与解析（完成，2026-10-02）

- Domain `chapter_reference`：地址的解析与规范写法（严格百分号解码，未知 `show` 按默认格式）。
  Rust `render::chapter_reference` 同一规则；两端各自单元测试同一批有效 / 错误地址。
- 编辑器：行内原子节点 `chapter_ref`（`href` 原样地址、`cached` 链接文字），Markdown 解析时把 `writer:` 链接合成一个记号，
  写出为标准链接。强调按定界规则写出（引用写成 `[`…`)`，紧挨中文时粗体无法表达而去掉）；
  链接与行内代码无法包裹引用，写出时去掉。粘贴 HTML 中的引用链接（含表格单元格）成为引用。
- Rust IR 新增 `Inline::ChapterRef { target, cached }`；Word / PDF 暂按链接文字输出（第 3 步生成文字与跳转）。
- 共享 fixture `chapter-refs`：三种格式、未知格式、中文 id、强调、链接文字中的格式与换行、空文字、格式错误、
  大写协议（普通链接）、表格与任务列表中的引用。
- 编辑器中暂以链接文字显示引用（第 2 步按章节树生成）。

### 第 2 步：编辑器展示（完成，2026-10-02）

- Domain `chapterRefText`：文字规则（不显示编号时只有标题；标题为空时只有编号），编辑展示与输出共用。
- `ui/editor/chapter_ref_view.ts`：`chapterRefLabels(tree)` 生成地址 → 文字；节点视图在章节树变化时（`setLabel`）
  直接更新显示，不经过事务；失效引用显示链接文字并加 `is-broken`（警示色、虚线下划线）。样式与正文链接相同。
- 写出：`serializeChapter(doc, format, refLabel)` 用当前文字作为链接文字；块缓存按 refLabel 区分，
  写出前的往返检查仍比较文档中保存的链接文字。章节树变化本身不产生新正文。
- 单击引用整体选中（插件在 mousedown 时选中，WebKit / Chrome 默认不选中行内的不可编辑节点），选中时与选中文字同色。
- 全文阅读：`renderChapterBody` 使用同一个 refLabel；章节树变化时只重新生成含引用的章节。
- 验证：Domain、ChapterDocuments、ChapterEditor（只更新显示不产生 change、编辑写出当前文字、单击选中）、全文阅读测试；
  新增 Story（编辑器 ChapterReferences，可模拟章节树变化；阅读器 Default 的“结论”一章）。
  Storybook（Chrome）中目视检查了正常 / 失效引用、章节树变化后的更新、选中状态与全文阅读；深色外观与 Tauri（WebKit）未目视检查。

### 第 3 步：导出（完成，2026-10-02）

- Rust `render::chapter_reference`：`ref_text`（与 Domain `chapterRefText` 相同的规则）、`ChapterTargets`（按 id 查找文档中的章节）、
  `broken_references`（遍历内容模型收集失效引用，不受渲染中重复测量的影响）。
- PDF：章节标题带标签 `<writer-chapter-N>`（按章节序号命名，不受 id 字符限制），引用写成 `#link(<…>)[文字]`，
  颜色与外部链接相同；编号写法与标题共用 `number_text`（跟随章节编号样式，不显示编号时只有标题）。
- Word：章节标题加隐藏书签 `_WriterChapterN`，引用是指向书签的内部超链接（链接颜色），编号写成 `2.1`，不使用域。
- 失效引用按链接文字输出；`ExportReport.brokenReferences` 传到前端，导出完成的提示中说明数量。
  PDF 排版设置的样张只包含文档开头的章节，指向样张之外章节的引用在样张中按链接文字显示（不影响正式导出）。
- 验证：Rust 文字规则与失效引用收集、PDF（三种编号样式的文字、文档内链接数量、报告）、Word（书签、内部超链接、报告）、
  前端报告解析与导出提示测试。手动样例（`write_sample`）加入引用，PDF 中目视检查了文字、颜色与跳转页码；Word 未在 Word / WPS 中目视检查。

### 第 4 步：插入与操作（完成，2026-10-02）

- 命令：`insertChapterRef`（插入到选区；选中引用时更换目标，保留强调并保持选中）、`setChapterRefShow`；
  编辑命令 `chapter-ref`（⌘K，“插入 → 章节引用…”，正文右键菜单“插入章节引用…”），代码块中不可用。
- `ChapterRefPicker`：光标下方的浮层（下方放不下时在上方，按下边缘定位），搜索框 + 章节列表（编号弱于标题，
  搜索时不缩进）+ 显示格式分段控件；↑↓ / Enter / Esc，点击确定，点击外部取消；格式默认是本次运行中上次的选择，
  更改已有引用时预先选中目标与格式。编辑器发出 `request-chapter-ref`，由工作区（持有章节树）显示浮层后调用
  `insertChapterRef`；发起后切换了章节则不插入。
- 已有引用：右键点在引用上先整体选中，菜单为“前往“编号 标题””“显示格式”“更改目标…”与剪切 / 拷贝（失效时不能前往）；
  ⌘ + 单击（其他平台 Ctrl + 单击）前往；悬停提示目标与前往方式，失效时提示章节不存在。
- 跳转（`use_chapter_jumps`）：前往时选中目标章节、光标置于正文开头，Toast“已前往“…””带“返回”（6 秒后消失）；
  “显示 → 返回上一位置”（无快捷键，全文阅读中不可用）。返回栈只记引用跳转，跳过已删除的章节，不持久化；
  编辑器为每个章节保留选区与滚动位置，返回后停在原处。全文阅读中单击引用滚动到目标章节开头（不记入返回栈）。
- 验证：命令、浮层（列表、筛选、键盘、点击、格式记忆、更改模式）、编辑器（⌘K 请求、插入、⌘ + 单击、右键菜单）、
  菜单栏、全文阅读与工作区端到端（插入、前往、提示与菜单返回、取消）测试；新增 Story（ChapterRefPicker 三种状态）。
  Storybook（Chrome）中目视检查了浮层的列表、搜索、键盘选择、更改模式与靠近底部；深色外观与 Tauri（WebKit）未目视检查。

### 第 5 步：更新交叉引用与删除提示（完成，2026-10-02）

- `ui/editor/chapter_ref_update.ts`：按编辑器的 Markdown 解析检查全部章节（代码中的文字不算，只解析含引用地址的正文）。
  `updateChapterRefs` 只重写链接文字过期的章节（整体按统一风格写出），失效引用带所在章节、序号与前后文字报告；
  `countRefsTo` 统计指向一组章节的引用。
- “插入 → 更新交叉引用”（无快捷键，全文阅读中不可用）：写回的章节由正常保存提交；编辑器中打开过的章节用
  `ChapterDocuments.adopt` 采用等价的新正文，编辑器状态与撤销历史不变。结果对话框 `ChapterRefReportDialog`：
  首行结论，失效引用列表（章节名称 + 前后文字，失效文字以警示样式标出），单击跳到该引用并选中它。
- 删除章节：其他章节中有引用指向它（包括子章节）时，即使是空章节也先确认，确认中说明引用数量（ui-spec §23 已更新）。
- 验证：检查模块、ChapterDocuments.adopt、章节树删除确认、菜单栏与工作区端到端（改名后更新、撤销历史不变、
  跳到失效引用、保存内容）测试；新增 Story（ChapterRefReportDialog 三种状态）。Storybook（Chrome）中目视检查了对话框；
  深色外观与 Tauri（WebKit）未目视检查。

### 返回 / 前进快捷键（完成，2026-10-02）

- “显示 → 返回上一位置”改为 ⌘[，新增“显示 → 前进到下一位置”（⌘]）：返回时把所在章节记入前进栈，
  重新前往别处时清空；同样跳过已删除的章节，全文阅读中不可用。
- 列表缩进不再占用 ⌘[ / ⌘]（编辑器按键表与格式菜单中去掉），继续用 Tab / Shift+Tab 与格式菜单。
- 验证：菜单项、快捷键对应、工作区端到端（菜单返回后前进、正文中按 ⌘[ / ⌘]）测试；npm test、vue-tsc 通过。

## 后续（MVP 之外，按价值排序）

2026-10-03 按发布需要重新整理。"未发现"表示代码中没有找到对应实现，实施前再确认。
已完成的旧条目：章节树键盘导航与键盘移动章节（ui-spec §29、known-risks #2）。

### P0：发布前补齐（影响信任或日常写作）

1. ~~查找 / 替换：当前章节与全文。~~（完成，见下方“P0-1 查找 / 替换”）
2. ~~结构操作撤销：删除章节后可恢复（目前只有删除确认）。~~（完成，见下方“P0-2 撤销删除章节”）
3. ~~字数统计：当前章节、全文、选中内容（界面中未发现）。~~（完成，见下方“P0-3 字数统计”）
4. ~~粘贴 / 拖入的图片自动导入项目资源（目前被忽略，只能通过"插入图片"）。~~（完成，见下方“P0-4 粘贴 / 拖入图片”）
5. ~~检查更新：直接分发时的更新机制（未配置 Tauri updater）。~~（完成，见下方“P0-5 检查更新”）

#### P0-1 查找 / 替换（完成，2026-10-03）

- “编辑 → 查找…”（⌘F）与“查找并替换…”（无快捷键）：工具栏下方的查找栏（`ui/app_shell/FindBar.vue`）。
  正文中有选中文字时作为查找词；再按 ⌘F 回到查找框。Enter 下一个、⇧Enter 上一个，Esc 关闭，焦点回到正文并选中当前匹配。
- 范围：本章 / 全文（分段控件）。全文按阅读顺序跨章节前进，到末尾回到开头；数量与“第 n 处，共 m 处”按全文计算。
- 匹配（`ui/editor/find.ts`）：文字块内、可跨格式边界，拉丁字母不区分大小写；章节引用、行内图片、换行不参与匹配；
  图注与章节标题不在查找范围内。匹配以淡黄高亮，当前匹配更深（`--color-doc-find*`）。
- 替换：替换当前匹配并前进；全部替换在范围内全部章节一次完成，每个章节一个可撤销的事务（其他章节进入各自的撤销历史），
  由正常保存提交。全文阅读中不可用。
- 验证：`find.test.ts`（匹配、前后、替换与撤销）、`app_shell/find.test.ts`（⌘F、计数、本章循环、全文跨章、替换、全部替换、
  保存、撤销、Esc 与预填）；Story `FindBar`（五种状态）。

#### P0-2 撤销删除章节（完成，2026-10-03）

- Application `remove_chapter.ts`：`describeRemoval` 记下被删章节的父章节与位置，`restoreRemovedChapter` 放回原处
  （原父章节不在时放到根层级末尾，位置超出时放到末尾）；Domain `replaceTree` 接受恢复章节的正文。
- `ChapterManager` 在发出新树前发出 `removed`；工作区 `use_removed_chapters.ts` 记下子树正文，提示“已删除“…””带“撤销”，
  章节树获得焦点时 ⌘Z /“编辑 → 撤销删除章节”撤销（菜单项随焦点替换“撤销”）。恢复是普通项目修改，正常保存提交。
- 验证：Application（原位置、之后的修改、父章节不在）、Domain（恢复正文）、工作区（提示撤销、保存、⌘Z 与焦点、菜单项）测试。

#### P0-3 字数统计（完成，2026-10-03）

- 规则（`domain/word_count`，参照 Word 的“字数”）：汉字、假名、韩文与全角 / 中文标点逐字计，其他文字按词计
  （词内的 ' ’ - 不拆开），空白与半角标点不计；另给出不含空白的字符数。
- 按看到的文字计算（`ui/editor/text_stats.ts`）：不计 Markdown 记号，图注计入，章节引用按显示的文字计，章节标题不计。
- 工具栏右侧一段安静的文字：本章字数，有选中内容时“已选 n 字”；点击打开统计浮层（选中内容 / 本章 / 全文的字数与字符数）。
  当前章节与选区由编辑器在正文或选区变化时报告（按文档缓存），全文只在打开浮层时计算，其他章节按正文缓存。
- 验证：计数规则、文字提取（记号、图注、引用、选区）、工作区（工具栏、选中、浮层、Esc）测试；Story `WordCountPopover`。

#### P0-4 粘贴 / 拖入图片（完成，2026-10-03）

- 编辑器 `handlePaste` / `handleDrop`：剪贴板或拖入内容中有图片文件、且没有文字时，发出 `request-image-files`
  （拖入时光标先移到放下的位置）；同时有文字（网页、Word 中复制的图文）时按原来的文字粘贴。
- 工作区依次导入：PNG / JPEG / GIF 原样，其他格式由 WebView 解码后转为 PNG（不能解码时说明不支持），
  `ProjectSession.importAssetData` → Rust `project_import_asset_data`（图片数据作为原始请求正文，路径与文件名百分号编码放在请求头）
  → `assets::import_asset_bytes`（格式按文件头判断，命名、去重、临时文件与 `import_asset` 相同）；之后与“插入图片”一样插入。
- 验证：Rust（按内容判断格式、扩展名、复用、不支持、非项目；请求头解码）、Tauri 存储（原始正文与请求头）、
  工作区（粘贴、图文粘贴不处理、拖入位置、导入失败、不支持的格式）测试。真实的系统剪贴板与 Finder 拖入未在 Tauri 中目视验证。

#### P0-5 检查更新（完成，2026-10-03）

- Rust `updater.rs`（`tauri-plugin-updater`）：`update_check`、`update_install`（下载、校验签名、安装）、`app_restart`；
  更新地址与公钥来自构建时的环境变量，缺失时返回 `not-configured`。重新启动的退出请求不经过窗口关闭流程（前端已先保存）。
- 前端：`DesktopShell.checkForUpdate / installUpdate / restartApp`；“帮助 → 检查更新…”（macOS 上“帮助”排在“窗口”之后）；
  `use_updates.ts` 与 `UpdateDialog.vue`（检查中、最新、未配置、失败、新版本与说明、安装中、已安装、安装失败）；
  启动 5 秒后后台检查，只有新版本才提示。发布流程见 decisions 第 10 节。
- 验证：Rust 结果序列化；App 测试（各种结果、安装与重新启动前保存、安装失败、后台提示与不打扰）；Story `UpdateDialog`（八种状态）。
  真实的更新服务器与签名安装未验证（需要发布环境）。

### P1：长文档写作核心能力

1. ~~脚注：Markdown 解析未开启脚注，导出为字面 `[^1]`（`render/markdown.rs`）。~~（完成，见下方“P1-1 脚注”）
2. ~~图表自动编号与引用（"见图 3""见表 2"）：已有图注，未发现自动编号，也不能像章节一样被交叉引用。~~（完成，见下方“P1-2 图表编号与引用”）
3. ~~参考文献 / 文献引用（未发现）。~~（完成，见下方“P1-3 参考文献”）
4. ~~数学公式（未发现）：Typst 原生支持，PDF 成本低；Word 需要转换为 OMML。~~（完成，见下方“P1-4 数学公式”）
5. ~~Word 导出目录：PDF 已有目录选项，Word 未发现。~~（完成，见下方“P1-5 Word 目录”）
6. ~~版本快照 / 历史（未发现）。~~（完成，见下方“P1-6 版本历史”）
7. ~~外部修改检测（文件监听 + 冲突提示，known-risks #4）。~~（完成，见下方“P1-7 外部修改检测”）
8. ~~打包开源中文字体，保证不同机器上 PDF 排版一致。~~（不做：曾实施，2026-10-04 产品负责人决定不打包并撤回，见 decisions 第 6 节）
9. ~~最近项目列表（目前只记住上次打开的项目）。~~（完成，见下方“P1-9 最近项目”）

#### P1-1 脚注（完成，2026-10-03）

- 规则见 decisions 第 11 节。编辑器：`markdown-it-footnote`（关闭行内脚注）→ `writer_footnote` 规则合成 `footnote` 记号，
  定义从记号流中去掉；写出时先写占位，整章写出后编号并追加定义（`withFootnotes`）；往返检查与定界调整把脚注当作以 [ 开头的原子。
- `footnote_view.ts`（编号 decoration、章末列表）、`FootnotePopover.vue`、命令 `insertFootnote` / `setFootnoteText`，
  “插入 → 脚注…”与右键菜单；全文阅读同样编号并列出。
- Rust：`ENABLE_FOOTNOTES`，`Inline::Footnote(内容)`（定义收集后替换引用占位，没有定义时是文字）；
  Word 脚注（`footnoteRef` 由占位替换、FootnoteText / FootnoteReference 样式），PDF `#footnote[…]`。
- 验证：编辑器解析 / 写出、编辑交互、全文阅读测试；共享 fixture `footnotes`（两侧契约）；Word（脚注部件、编号标记、样式）
  与 PDF（页底、全文连续编号）测试；Story `ChapterEditor/Footnotes`、`FootnotePopover`（Storybook 中目视检查了编号、章末列表与编辑浮层）。

#### P1-2 图表编号与引用（完成，2026-10-03）

- 规则见 decisions 第 12 节、格式见 project-format 4.2。Domain：地址解析增加 `element`，`elementRefAddress`、`elementLabel`、`newElementId`。
- 编辑器：表格的 caption / captionId（`writer_table_caption` 规则读、`serializeTable` 写，段首 `Table:` 转义）；
  `element_numbering.ts`；图注前的编号（图片节点视图读取 decoration）与表格上方的标题（widget，单击 / 右键编辑，`TextPopover`）；
  `setTableCaption`、`setElementId`。工作区 `use_elements.ts` 全文索引（只在编号或标识变化时更新引用文字），
  ⌘K 浮层列出图表，第一次引用时为图表写入标识（其他章节在缓存的编辑器状态上修改）。全文阅读显示同样的编号。
- Rust：`Block::Table.caption`、`Inline::Image.id`、`Inline::ElementRef`、`Address::Element`；`render::elements` 编号；
  Word（图注 / 标题前编号、书签、内部超链接）、PDF（编号、标签、链接）；失效图表引用列入导出报告。
- 验证：Domain、编号（TS / Rust 相同用例）、解析与写出、工作区端到端（显示、⌘K、标识写入、编号变化后的文字、前往、表格标题编辑、全文阅读）、
  Word / PDF 输出测试；共享 fixture `element-refs`；Story `ChapterEditor/FiguresAndTables`、`ChapterRefPicker/WithFiguresAndTables`、
  `TextPopover`。Storybook 中目视检查了编号与表格标题。

#### P1-3 参考文献（完成，2026-10-03）

- 规则见 decisions 第 13 节，格式见 project-format 3.3、4.3。Domain `bibliography`（条目、校验、著录格式、引用编号、标识）；
  `WriterDocument.references`、`setReferences`，manifest 读写，`ProjectSession.setReferences`；导出请求携带格式化后的条目。
- 编辑器：地址解析增加 `cite`，`citationRefLabels`（上标“[n]”），命令 `citation`、右键“更改文献…”；
  `CitationPicker.vue`；工作区 `use_citations.ts`（按阅读顺序扫描引用地址编号，插入时按位置计算编号）、`ReferencesDialog.vue`。
- Rust：`Address::Cite`、`Inline::Citation`、`render::citations`；Word / PDF 上标引用、文末参考文献（Bibliography 样式 / 悬挂缩进），
  失效引用列入报告。
- 验证：著录格式与编号、manifest、导出请求、契约 fixture `citations`、Rust 编号与 Word / PDF 输出、工作区端到端
  （插入与编号后移、对话框新建 / 取消 / 删除确认、浮层中添加）测试；Story `CitationPicker`、`ReferencesDialog`（Storybook 中目视检查了对话框）。

#### P1-4 数学公式（完成，2026-10-03）

- 规则见 decisions 第 14 节。Markdown：编辑器 `writer_math` 行内规则与 `writer_math_block`（与 pulldown-cmark ENABLE_MATH 相同），
  写出 `$…$` / `$$…$$`，文字中的 `$` 转义；schema `math` / `math_block`。
- 编辑器：`math_view.ts`（KaTeX，`renderToString`）、`MathPopover.vue`（LaTeX + 实时预览）、命令 `math` / `math-block`、
  `insertMath` / `insertMathBlock` / `setMath`、输入规则 `$…$`；全文阅读同样显示。
- Rust：`Inline::Math`、`Block::as_math`；`export::math`（mitex 转换、vendored 规格与 Typst 0.15 兼容补丁、Word 中渲染为 PNG）；
  PDF 公式定义放在源码开头，出错的公式改用替代后重排；报告 `invalidFormulas`，导出提示中说明。
- 验证：解析 / 写出、共享 fixture `math`、编辑交互（显示、插入、编辑、删除、撤销、输入规则、阅读）、常用 LaTeX 写法在 PDF 中都能排版、
  Word 中嵌入图片、失败回退测试；Story `ChapterEditor/Formulas`、`MathPopover`（Storybook 中目视检查了公式显示）。
- 可视编辑（2026-10-04）：`MathPopover.vue` 默认用 MathLive（`mathlive`，字体复用 KaTeX 的，不加载声音），常用结构与符号面板，
  “LaTeX”切换到源码；写出时展开 MathLive 命令、去掉空位、`\sqrt[]` → `\sqrt`（mitex 不接受）。测试环境把 `mathlive` 指向浏览器版本
  （`vite.config.js`）。验证：浮层组件测试（未修改保存原文、结构插入、符号、Esc / Enter 交给 LaTeX 命令输入、源码切换与记忆）、
  编辑器集成测试、浮层可能写出的写法在 PDF 中都能排版；Storybook 中目视检查了可视编辑、模板插入、符号面板、源码切换与 Esc。
  未检查深色外观与 Tauri WebView 中的中文输入法。

#### P1-5 Word 目录（完成，2026-10-03）

- `export::docx`：封面之后插入目录（`TOCHeading` 样式的标题 + docx-rs 自动填充的目录域，层级 1–2，hyperlink、dirty）；
  有封面时目录另起一页，第一章仍另起一页。目录生成的书签占用小的 id，章节书签的 id 移到 3,000,000 起。
- 验证：目录域与层级、标题样式、预填条目、书签 id 不重复测试。未在 Word / WPS 中目视检查更新后的页码。

#### P1-9 最近项目（完成，2026-10-03）

- Application `recent_projects.ts`：应用偏好 `recentProjects`（最近的在前，最多 10 个，Writer 与 Writer Dev 各一份）。
- 欢迎页“最近打开”列表（名称 + 路径），“文件 → 打开最近”子菜单（文件夹名）与“清除菜单”；打开成功时记入，打不开时从列表中去掉。
- 验证：列表规则、欢迎页打开、菜单切换与清除、打不开时去掉测试；Story `WelcomeView/WithRecent`。

#### P1-6 版本历史（完成，2026-10-03）

- 格式见 project-format 7.1。Rust `storage::snapshots`（创建、列表、读取、删除、自动版本上限）与 `snapshot_*` 命令；
  `ProjectStorage` 增加快照接口，`ProjectSession.createSnapshot`（先保存）/ `restore`（作为一次修改）。
- “文件 → 版本历史…”（`HistoryDialog.vue`、`use_history.ts`）：保存当前版本（可命名）、列表、恢复（确认后先留下恢复前的版本）、删除；
  打开文档后距最近版本超过一天时自动留下一个版本。
- 验证：Rust 快照（读写、顺延、损坏忽略、自动版本上限、路径校验）、工作区（自动版本、保存、恢复与保存、取消、删除）测试；Story `HistoryDialog`。

#### P1-7 外部修改检测（完成，2026-10-03）

- 规则见 known-risks #4。Rust `project_read`（不取锁读取）；`ProjectStorage.read`；`application/external_changes.ts`（比较）；
  `ProjectSession.saved` / `adoptDiskContents` / `resetToDisk` / `markChanged`。
- 工作区 `use_external_changes.ts`（焦点与 15 秒定时检查）、`ExternalChangeDialog.vue`；静默载入时提示载入的章节。
- 验证：比较规则、工作区（静默载入、保留并覆盖、使用磁盘、结构变化、自己的保存不误报）测试；Story `ExternalChangeDialog`。
  采用定时读取而不是系统文件监听：实现简单、跨平台一致，代价是最多约 15 秒的延迟。

### P2：体验提升

1. ~~专注模式 / 全屏写作。~~（完成，见下方“P2-1 专注模式”）
2. ~~章节状态或标签（草稿 / 待修改 / 完成）与章节备注。~~（完成，见下方“P2-2 章节状态与备注”）
3. ~~写作目标（字数目标、进度）。~~（完成，见下方“P2-3 写作目标”）
4. ~~更多导出格式：合并的 Markdown、HTML、EPUB。~~（完成，见下方“P2-4 其他导出格式”）
5. ~~文档模板（论文、报告、书稿）。~~（完成，见下方“P2-5 文档模板”）
6. ~~富文本粘贴识别 Word / WPS 的列表段落（目前是带 · 的普通段落）。~~（完成，见下方“P2-6 粘贴 Word / WPS 列表”）
7. ~~大量章节虚拟滚动（ui-spec P1；1050 章节实测暂不需要；拖入折叠节点自动展开、拖拽自动滚动已完成）。~~（完成，见下方“P2-7 章节树虚拟滚动”）
8. ~~化学式与化学方程式。~~（完成，见下方“P2-8 化学式”）
9. ~~化学结构式：SMILES + smiles-drawer + 常见分子库，` ```smiles ` 代码块，输出为图片。~~（完成，见下方“P2-9 化学结构式”）

#### P2-1 专注模式（完成，2026-10-03）

- 规则见 decisions 第 15 节。`DesktopShell.setFullscreen`（Tauri `setFullscreen`，权限 `core:window:allow-set-fullscreen`）；
  工作区 `focusMode`（`workspace--focus`：侧栏隐藏、工具栏悬浮显现），编辑器 `focusMode`（`is-focus-block` decoration 与淡化样式）。
- 验证：菜单进入、全屏、侧栏、淡化随光标、退出按钮、全文阅读时退出测试；Story `ChapterEditor/FocusMode`（Storybook 中目视检查了淡化）。
  Tauri 中的全屏与工具栏悬浮显现未目视检查。

#### P2-2 章节状态与备注（完成，2026-10-03）

- 规则见 decisions 第 16 节。Domain `ChapterNode.status / note`、`validateTree` 校验、`setChapterMeta`；Application `chapter_meta.ts`。
- 章节树行尾标记与节点菜单（ui-spec §23.1），`ChapterManager.setStatus / setNote`；菜单栏“章节 → 状态 / 备注…”；
  `TextPopover` 支持多行；编辑器标题下方显示备注。
- 验证：Domain（设置、去掉、校验）、章节树菜单、工作区（状态圆点、保存、菜单打勾、备注多行、编辑器显示与编辑、清空）测试；
  Story `ChapterTree/StatusAndNotes`（Storybook 中目视检查了标记）。

#### P2-3 写作目标（完成，2026-10-03）

- 规则见 decisions 第 17 节。`ui_state.ts` / `use_ui_state.ts` 增加 `goal`、`today`；`WordCountPopover` 增加目标区（设置、进度条、今日新增、取消）；
  工作区在打开字数统计时记下当天的起点。
- 验证：界面状态往返与非法值、工作区（设置目标、百分比、今日新增、保存、取消）测试；Story `WordCountPopover/WithGoal`、`WithoutGoal`。

#### P2-4 其他导出格式（完成，2026-10-03）

- 规则见 decisions 第 18 节。Rust `export::html`（XHTML 渲染，HTML 与 EPUB 共用；无依赖的 base64）、`export::epub`（zip 打包、nav、opf）、
  `export::markdown`（从中间模型写 Markdown，复制图片）、`export::math::render_svg`；命令 `export_html` / `export_epub` / `export_markdown`。
- 前端：`ExportFormat` 增加三种格式，保存对话框的扩展名与说明，工具栏导出菜单与“文件 → 导出为其他格式”。
- 验证：Rust（HTML 标题 / 引用 / 脚注 / 文献 / 转义 / 公式 SVG / 缺失图片；EPUB 包结构、按一级章节分文件、跨文件链接、nav 嵌套、opf；
  Markdown 引用文字、图注编号、转义、脚注连续编号、参考文献、图片复制；base64；日期）、前端命令路由与工作区导出测试。
  未在电子书阅读器与其他 Markdown 工具中目视检查。

#### P2-5 文档模板（完成，2026-10-04）

- 规则见 decisions 第 19 节。Application `createProject(…, outline)` 与 `outlineTree`（新 id、备注、空正文）；
  `ui/app_shell/document_templates.ts`（三个模板）；欢迎页模板按钮、菜单 `file:templates` / `file:template-*`。
- 验证：按大纲建树并写入磁盘、菜单解析、欢迎页与菜单栏从模板新建测试；Storybook 中目视检查了欢迎页。

#### P2-6 粘贴 Word / WPS 列表（完成，2026-10-04）

- 规则见 decisions 第 20 节。`ui/editor/office_lists.ts`（`officeListsToHtml`），剪贴板插件的 `transformPastedHTML`。
- 验证：无序 / 有序、层级嵌套、起始编号、条件注释两种形式与中文编号，以及在编辑器中粘贴得到的 Markdown 测试。
  使用按 Word / WPS 剪贴板格式构造的 HTML，未从真实 Word / WPS 复制验证。

#### P2-7 章节树虚拟滚动（完成，2026-10-04）

- `ui/chapter_tree/use_row_window.ts`：可见行达到 300 行且量得到滚动区域高度时，只渲染可见区域上下各 20 行；
  行高固定（`--tree-row-h`），按序号绝对定位，列表保持全部行的高度。选中、键盘焦点、重命名、拖拽中与菜单作用的行始终渲染，
  焦点、输入框与拖拽源不会因滚动消失。行数少时与之前完全相同（正常文档流）。
- 验证：窗口范围、渲染行数与定位、滚动后更新、↓ 移到窗口外的行获得焦点、少于阈值时渲染全部行测试；
  Storybook `App/LargeDocument`（1050 章节）中滚动后只渲染 41 行、位置正确。未在 Tauri 中目视检查长距离拖拽。

#### P2-8 化学式（完成，2026-10-05）

- 规则见 decisions 第 22 节。编辑器：`math_view.ts` 引入 KaTeX mhchem；`chem.ts`（`chemContent` / `chemTex`）；
  命令 `chem` / `chem-block`（插入菜单、右键菜单）；`MathPopover.vue` 的化学式模式（常用写法、输入框、预览）。
- Rust：`export::chem`（`\ce{…}` → LaTeX，在 `math::to_typst` 中展开）；`export::math` 使用调整过的 mitex 命令规格，
  可伸长箭头接受 `[下方]`（vendored 规格中的 `arrow-handle` 同步修改，见 WRITER-PATCH.md）。
- 验证：转换单元测试（与 mhchem 原版的展开结果对照）、化学式与箭头在 PDF 中排版不回退、箭头的下方文字不再是方括号、
  共享 fixture `math`、浮层组件测试（内容编辑、原文保留、常用写法插入）、编辑器集成测试（显示、插入、双击编辑、混合公式）；
  Story `MathPopover/NewChem`、`EditingChem`、`ChapterEditor/Chemistry`，Storybook 中目视检查了浮层与正文中的显示。
  未检查深色外观、Tauri WebView 中的输入法，以及 Word / WPS 中化学式图片的实际效果。

#### P2-9 化学结构式（完成，2026-10-05）

- 规则见 decisions 第 22 节。编辑器：schema `structure`；`markdown.ts`（`writer_structure` 规则、逐行写出的围栏、`structureSources`）；
  `structure_view.ts`（smiles-drawer 绘制、节点视图、全文阅读、导出 PNG 与 `documentStructureImages`）；`structure_library.ts`；
  `StructurePopover.vue`；命令 `structure`、`insertStructure` / `setStructure` / `selectedStructure`，右键“编辑结构式…”。
- 导出：`document_output.ts` 的 `RenderStructure` / `StructureDrawer`（Markdown 导出不画图，样张只画一次）；报告 `invalidStructures` 与导出提示。
  Rust：`Block::Structure`、`RenderRequest::structures`（base64 PNG 解码，`base64` crate）；PDF / Word / HTML / EPUB 中的居中图片与原文回退。
- 验证：Markdown 解析 / 写出（引用与列表中）、共享 fixture `structures`、分子库（全部可画出、查找排序）、浮层组件测试、编辑器集成测试
  （显示、插入、双击 / Enter 编辑、清空删除、撤销、全文阅读）、应用层请求组装、各导出器的嵌入与回退；
  Story `StructurePopover/*`、`ChapterEditor/Structures`，Storybook（Chrome）中目视检查了浮层、正文显示与导出 PNG，
  并把浏览器画出的 PNG 交给 PDF 导出检查了页面效果。未检查深色外观、Tauri WebView（WKWebView / WebView2）中的栅格化，
  以及 Word / WPS 中的实际效果。
- 反应式（2026-10-05）：`markdown.ts` 的 `parseStructureInfo` / `normalizeArrow` 与写出（Rust `StructureConditions`，共享 fixture `structures`）；
  schema `structure` 增加 `arrow` / `above` / `below`；`structure_view.ts` 拼合各分子的绘图、“＋”、箭头（→ ⇌ ＝）与条件文字，
  库中的无机小分子写成化学式；`StructurePopover.vue` 的“反应式”（名称或 SMILES 以 + 分隔、匹配列表、箭头、条件）；
  导出图片按 SMILES 与条件对应（`RenderStructure` 带条件，Rust `StructureKey`）。验证：画法、浮层、编辑器插入、Markdown 读写与转义、
  合并 Markdown 的往返、PDF 按条件对应图片；Storybook 中目视检查了正文与浮层，浏览器画出的反应式 PNG 经 PDF 导出检查了页面效果。
- 输入与方向改进（2026-10-08，规则见 decisions 第 22 节）：`structure_library.ts` 的 `smilesText`（全角与输入法符号）、
  `usedMolecules`（本文档中用过的分子；`ChapterEditor` 的 `otherStructures` 由 `Workspace` 按阅读顺序提供，本章取编辑器中的文档）；
  `structure_view.ts` 的 `smilesProblem`（括号配对自己找位置，其他用 smiles-drawer 报告的位置）与方向（`orient` 在 smiles-drawer 的
  `rotateDrawing` 之后转原子坐标，翻转时互换楔形键）；`StructurePopover.vue` 的“本文档中”列表、出错说明、“编辑 SMILES”按钮与 Tab、方向按钮，固定高度的列表与预览、浮层式的反应式匹配。
  格式：`rotate` / `flip`（schema、`parseStructureInfo` / 写出、`structureKey`；Rust `StructureConditions`、共享 fixture `structures`）。
  验证：组件与编辑器集成测试、Markdown 读写、画法（旋转后宽高互换、翻转后符号仍正、楔形键互换）、Rust 按方向对应图片；
  Storybook（Chrome）中目视检查了浮层（用过的分子、Tab、旋转与翻转、出错标注）与正文中的旋转、翻转。未检查深色外观、
  Tauri WebView 中的显示与导出 PNG。
- 反应式中每个分子的方向（2026-10-08）：`rotate` / `flip` 改为每个分子一项的列表（`normalizeOrientation`，Rust `Vec`）；
  `structureMolecules` 给出方向对应的分子，`drawReaction` 按序号转各分子并标 `data-molecule`；浮层中点击预览选中分子、垫底色，
  方向按 SMILES 跟着分子走。验证：Markdown 读写（列表、去掉末尾默认值）、共享 fixture、只转其中一个分子的画法、浮层选中与重新对应、
  Rust 反序列化与按方向对应图片；Storybook 中目视检查了选中、旋转与正文中的反应式。

#### P2-10 表注（完成，2026-10-05）

- 规则见 decisions 第 12 节（表注），格式见 project-format 4.2。编辑器：schema table 的 `note`；`markdown.ts`
  （`writer_table_note` 规则读、`serializeTable` 写，段首 `Table-note:` 转义）；`setTableNote`；表格下方的 widget
  （单击 / 右键“添加 / 编辑表注…”，`TextPopover`）；全文阅读显示表注。
- Rust：`Block::Table.note`；Word（TableNote 样式、最后一行与表注同页）、PDF（不重复的表脚，先测量表格宽度再限制表注宽度）、
  HTML / EPUB、Markdown 导出。
- 验证：Rust 解析、共享 fixture `table-notes`、菜单、工作区端到端（添加、单击编辑、清空、保存的正文、全文阅读）、
  Word（样式、位置、keepNext 只在最后一行）、PDF（20–45 行跨过分页处时表注总与最后一行同页、长表注不撑宽列）、HTML / Markdown 导出。

#### P2-11 内置版式（完成，2026-10-07）

- 规则见 decisions 第 19 节，取值见 pdf-layout 4.1 节。Domain `PDF_LAYOUT_PRESETS` / `matchPdfLayoutPreset`；
  `PdfLayoutDialog` 选项最上方的“版式”分段控件；`SegmentedControl` 支持没有选中项（第一项占 Tab 位置）。
  模板对应的版式（论文 → 学术、书稿 → 书籍）尚未实施。
- 验证：Domain（版式只含非默认的合法项、按完整配置匹配）、分段控件无选中项、排版设置（整体替换、选中状态随修改变化、提交内容）测试；
  Story `PdfLayoutDialog/AcademicPreset`、`SegmentedControl/NoSelection`（Storybook 中目视检查了选择版式、改动后取消选中与样张更新）。

#### P2-12 错误日志（完成，2026-10-07）

- 规则见 decisions 第 25 节。Rust：`tauri-plugin-log`（`app_log.rs`：日志目录与 stdout、大小与轮换、启动信息、panic 钩子、
  `reveal_log_folder`）；前端：`infrastructure/tauri_log.ts`（`installErrorLog` 转发 console.error / warn 与未处理的异常，
  `main.ts` 中最先接上）；菜单“帮助 → 显示日志文件夹”（`app:show-logs`，`DesktopShell.revealLogFolder`）。
  `structureImage` 失败时记录失败的步骤与错误（排查 Windows 上结构式导出为红色原文）。
- 验证：日志行格式（字符串、JSON、Error / DOMException 与调用栈、无法序列化的值）、欢迎页与工作区的菜单测试；
  开发版启动后日志文件中有启动信息。未在 Windows 正式包中检查。

#### P2-13 扩展分子库（完成，2026-10-08）

- 规则见 decisions 第 22 节“分子库”。`scripts/molecules`：`fetch.sh`（QLever 的 Wikidata 查询，结果不提交）、`build.py`
  （RDKit 清洗与凯库勒式、OpenCC 简体、pypinyin 首字母）→ `src/ui/editor/molecules_extended.json`（以文字导入再解析，单独的 chunk）。
  `structure_library.ts`：`loadExtendedMolecules`、查找写法与拼音首字母、`moleculeBySmiles(smiles, withExtended)`、`sideText` 只写能换回同一分子的名称；
  `StructurePopover.vue` 打开时加载，加载后重新查找，“扩展”标记。
- 验证：扩展库全部 SMILES 可由 smiles-drawer 画出、不与核心库重复；查找排序、拼音首字母、全角与连接符号、同名分子的反应式写法；
  浮层与编辑器测试先加载扩展库。Story `StructurePopover/ExtendedSearch`、`PinyinInitials`，Storybook（Chrome）中目视检查了列表、
  “扩展”标记与带楔形键的大分子预览。未检查深色外观与 Tauri WebView 中的加载时间。

#### P2-14 核心分子库扩充（完成，2026-10-08）

- 规则见 decisions 第 22 节“分子库”。在 `structure_library.ts` 的各分类中加入 289 个高中与大学有机化学常见物质（共约 380 个）：
  候选清单的英文名称在 PubChem 查 SMILES，RDKit 转凯库勒式、去立体构型，与扩展库同名分子、现有核心库对照；
  有标记（顺反构型、盐、链状糖、与 PubChem 或扩展库写法不一）的 16 个经产品负责人确认不收。
  `scripts/molecules/build.py`：与核心库骨架相同但标了立体构型的扩展库分子保留；重新生成扩展库（11,893 个）。
- 验证：核心库全部可画出且不重复（原有测试）；测试中“库外的分子”改用确实不在库中的 SMILES。

### 发布准备（非功能）

1. 手动验收清单在正式包中全部走一遍（需要真实桌面环境与 Word / WPS，known-risks #5）。
2. Mac App Store：App Sandbox 改造——上次打开的项目改用 security-scoped bookmark 记录，逐一验证新建、打开、
   导入图片、导出、项目锁、硬链接换名、读取用户字体；entitlements 与签名配置。
3. 正式图标、正式名称。（identifier 已定为 `io.github.tanjiasong006.writer`，2026-10-10）
7. 发布构建：GitHub Actions（`.github/workflows/release.yml`），推送 `v*` 标签后构建 macOS 通用包与 Windows 包并上传草稿 Release，
   流程见 decisions 第 10 节。（流水线已加入，2026-10-10；尚未实际运行，第一次发布时验证构建、`latest.json` 与从旧版本自动更新。）
4. 关于窗口、帮助 / 支持入口、隐私政策。
5. 中国大陆区上架需要 APP 备案。
6. 国际化：界面翻译；导出的"文档语言"设置（章节 / 页码 / 图表文字、段落样式、断词、字体、纸张）。

## 手动验收清单（需要在真实桌面环境执行）

1. 新建文档 → 选择位置 → 出现空状态；新建章节、子章节，输入正文。
2. 拖动章节改变结构 → 等待约 1 秒自动保存（工具栏没有出现"保存失败"） → 在 Finder 中确认 `content/ch_*.md` 文件名随编号变化、内容正确。
3. 退出应用重开 → 自动打开上次项目，选中章节与折叠状态恢复。
4. 把项目文件夹设为只读 → 编辑 → 状态显示"保存失败"；关闭窗口时出现确认。
5. 导出 Word 后用 Word / WPS 打开：标题层级出现在导航窗格；有序列表显示为 1. 2.（macOS textutil 会把所有列表显示成圆点，属于 textutil 限制）；
   表格、图片、代码块、引用样式正确；中文字体为宋体 / 黑体。
   有文档信息时第一页为封面（标题约在页面 1/3 高处，无页眉页码），正文第一页页码为 1；一级章节另起一页；
   正文首行缩进、两端对齐；三线表；引用左侧竖线。
   样例生成：`WRITER_SAMPLE_DIR=<目录> cargo test write_sample -- --ignored`（同时生成 docx 与 pdf）。
6. 导出 PDF 后打开：书签与章节结构一致、中文字体正常、图片与表格正确、页脚页码。
7. 编辑正文后立即 Cmd+Q（Windows：关闭窗口）→ 修改已保存；保存失败时出现确认而不是直接退出。
8. 同一项目在第二个 Writer 实例中打开 → 提示"已在另一个 Writer 窗口中打开"。
9. 在测试项目 content/ 中放一张损坏的图片并引用 → 编辑器显示占位、导出成功并提示图片无法嵌入。
10. 章节树中用 Tab 进入 → ↑↓←→ 浏览、Enter 进入正文；Shift+F10 打开章节菜单上移 / 下移 / 升级 / 降级；⌘⌫ 出现删除确认。
    纯键盘：正文中 ⌘J 回到章节树（选中行由灰色变为强调色），再按 ⌘J 回到正文（光标位置不变）；侧栏隐藏时 ⌘J 先显示侧栏；
    章节树中 h j k l 浏览，⌘N 新建章节 → 输入标题 → Enter 留在章节树（与重命名相同），⌘↩ 重命名，⌘↑ ⌘↓ ⌘← ⌘→ 移动；
    正文中 ⌘N、⌘↩、⌘ + 方向键不作用于章节（⌘↩、⌘ + 方向键仍是编辑器自己的按键）；⇧⌘N / ⇧⌘O 新建 / 打开文档，欢迎页也显示新按键。
11. （已在 Writer Dev 中验证，发布前在正式包中复核）macOS 菜单栏与右键菜单：正文中按 ⌘B、⌘Z、章节树中按 ⌘⌫ 各只执行一次；
    章节树获得焦点时"章节 → 上移""删除章节"可用、正文中不可用，正文中 ⌘⌫ 仍是删除到行首；正文右键菜单的"粘贴"可用；
    重命名章节时 ⌘Z 撤销输入框中的文字；拖动工具栏空白处可以移动窗口，双击缩放窗口。
12. 上下标：正文中选中文字，“格式 → 上标 / 下标”可勾选、互斥；在上标末尾按 → 后光标恢复正文大小，输入的是普通文字
    （粗体、斜体同样；用中文输入法输入也正常）；导出 Word 后在 Word / WPS 中是“上标 / 下标”格式，
    PDF 中位置与大小正常；在其他 Markdown 工具中打开正文，`m<sup>3</sup>` 显示为上标。
