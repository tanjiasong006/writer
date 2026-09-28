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
| S7 | 全文预览（Rust pulldown-cmark 渲染） | ✅ 完成 |
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

### S7（完成）

- Rust `render/`：`markdown.rs` 把正文解析为统一的块 / 行内模型（表格、列表、引用、代码、图片、删除线、任务列表），
  引用 / 列表嵌套超过 32 层时压平为文本（10000 层 `>` 不会栈溢出）；`html.rs` 输出全文预览。
- 安全：原始 HTML 一律当作文本；所有文本转义；链接只展示不跳转；图片只解析项目目录内的文件（规范化路径，防符号链接逃逸）。
- 章节标题 / 编号来自结构（`buildRenderRequest`，按阅读顺序展开）；正文内的 `#` 标题层级叠加在章节层级之下。
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
暂不需要虚拟滚动。

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

## 后续（MVP 之外，按价值排序）

1. 手动验收清单全部走一遍（需要真实桌面环境与 Word / WPS）。
2. ~~章节树键盘导航与键盘移动章节（ui-spec §29、known-risks #2）~~ 已完成。
3. 拖入折叠节点自动展开、拖拽时自动滚动、大量章节虚拟滚动（ui-spec P1）。
4. 结构操作撤销（删除章节后可恢复）。
5. 外部修改检测（文件监听 + 冲突提示）。
6. 打包开源中文字体，保证不同机器上 PDF 排版一致。

## 手动验收清单（需要在真实桌面环境执行）

1. 新建文档 → 选择位置 → 出现空状态；新建章节、子章节，输入正文。
2. 拖动章节改变结构 → 等待"已保存" → 在 Finder 中确认 `content/ch_*.md` 文件名随编号变化、内容正确。
3. 退出应用重开 → 自动打开上次项目，选中章节与折叠状态恢复。
4. 把项目文件夹设为只读 → 编辑 → 状态显示"保存失败"；关闭窗口时出现确认。
5. 导出 Word 后用 Word / WPS 打开：标题层级出现在导航窗格；有序列表显示为 1. 2.（macOS textutil 会把所有列表显示成圆点，属于 textutil 限制）；
   表格、图片、代码块、引用样式正确；中文字体为宋体 / 黑体。
   样例生成：`WRITER_SAMPLE_DIR=<目录> cargo test write_sample -- --ignored`（同时生成 docx 与 pdf）。
6. 导出 PDF 后打开：书签与章节结构一致、中文字体正常、图片与表格正确、页脚页码。
7. 编辑正文后立即 Cmd+Q（Windows：关闭窗口）→ 修改已保存；保存失败时出现确认而不是直接退出。
8. 同一项目在第二个 Writer 实例中打开 → 提示"已在另一个 Writer 窗口中打开"。
9. 在 content/ 中放一张损坏的图片并引用 → 预览显示占位、导出成功并提示图片无法嵌入。
10. 章节树中用 Tab 进入 → ↑↓←→ 浏览、Enter 进入正文；Alt+Shift+方向键 移动章节，确认 macOS / Windows 上这些组合键未被系统或输入法占用。
