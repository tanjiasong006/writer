# editor

## 职责

章节正文的结构化编辑（ProseMirror）。正文在应用中始终是 Markdown 字符串（Domain `WriterDocument.contents`），
编辑器在 UI 层把它解析为 ProseMirror 文档、编辑后再写回 Markdown。Domain、Application、存储与 Rust 导出不感知 ProseMirror。

## 模块

| 文件 | 职责 |
|---|---|
| `schema.ts` | 正文结构的权威定义。只包含 Markdown 能表达、Rust 渲染器能渲染的结构；没有标题与 HTML。 |
| `markdown.ts` | Markdown ⇄ 文档。`parseChapter` / `serializeChapter`（保持 CRLF、BOM、结尾换行）、`appendImage`。 |
| `commands.ts` | 编辑命令（格式、结构、插入、表格行列、撤销）与它们的可用 / 激活状态（`commandState` 只从 EditorState 推导）。 |
| `editor_menu.ts` | 编辑命令在菜单中的名称与快捷键，正文右键菜单的内容（按点击处：图片、表格、文字）。 |
| `plugins.ts` | 快捷键、输入规则、撤销历史、表格编辑、占位提示、剪贴板；`createEditorState`。 |
| `caret.ts` | 自绘文字光标：WebKit 原生光标在段落第二行起高度不对，改为按文字高度绘制（输入法组字期间用原生光标）。 |
| `selection.ts` | 自绘选区底色：WebKit 原生底色从段落中间开始选择时第一行偏高，改为每行一整行行高、行与行首尾相接。 |
| `figure_editing.ts` | 独立成段的图片（figure 节点）的编辑：Enter、Backspace / Delete，以及把只剩一张图片的段落转成 figure。 |
| `chapter_documents.ts` | 应用状态 ⇄ 编辑器状态的适配：每章节一个 EditorState，决定何时产生新正文。 |
| `image_view.ts` | 图片节点视图（figure 与行内图片）：按项目资源显示，无法显示时占位；figure 下方显示并编辑图注。 |
| `editor_theme.ts` | 编辑环境的正文展示参数（目前只有默认值）→ CSS 变量；与 Word / PDF 的输出参数无关。 |
| `ChapterEditor.vue` | 挂载 EditorView、响应章节切换、发出 change；右键菜单。编辑器没有自己的工具栏：它发出 `tools` 供工作区与菜单显示，通过 `runCommand` 接受内容编辑命令。 |

## 数据流

```text
props.content ──stateFor──▶ EditorState ──▶ EditorView
                                 ▲              │ 事务
                                 └── update ◀───┘
                                       │ 文档改变时返回新正文
                                       ▼
                          emit('change', chapterId, markdown) → ProjectSession.setContent → 自动保存
```

## 不变量

- 整个组件只有一个 EditorView；切换章节用 `updateState` 换入该章节缓存的 EditorState，不重建视图。
- 只有文档改变才产生正文；选区、焦点变化不会触发保存。change 携带事务发生时的章节 id。
- 未被编辑的章节永不写回；编辑后又回到载入时的文档，写回载入时的原文。
- 父组件回传的 content 与缓存一致时什么都不做；不一致（外部修改）时用一个事务替换文档并以新正文为基准，不回发 change。
- 任何结构（列表、引用、代码块、表格、图片）都能只用键盘进入和离开；写作中的 Tab / Shift+Tab 由编辑器处理，
  焦点不会意外移出正文；先按 Esc 再按 Tab / Shift+Tab 时焦点按浏览器默认方式离开正文。
- 正文不支持标题与 HTML：Markdown 标题与原始 HTML 都是文字（标题是原文文字的段落，如“## 研究背景”），
  输入 `# ` 不产生标题；与 Rust 导出的规则相同，由共享 fixture 约束（decisions 第 8 节）。
- 独占一段的 Markdown 图片在编辑器中是块级原子节点 figure，与文字同处一段、在表格单元格中的是行内图片 image。
  光标不能停在 figure 旁边，文字（包括输入法）只会进入前后的段落。Markdown 不变：figure 写成与只含这张图片的段落相同的文字；
  编辑使段落只剩一张（不带链接的）图片时，它成为 figure，与 Rust 内容解析的独立图片判断一致；
  该语义由跨实现测试约束，不依赖应用内预览。
- figure 的图注就是图片的替代文字（`![图注](src)` 方括号中的文字），导出为 PDF / Word 的图注；编辑器在图片下方显示它，
  所见即导出。图注在图片节点内用原生文本框编辑，figure 仍是原子节点，schema 与 Markdown 不变：
  - 点击图注、或右键菜单“添加图注 / 编辑图注”进入编辑；没有图注的图片只在选中时显示“添加图注”提示，平时不占位置。
  - 图注只有一行文字（换行替换为空格，首尾空白去掉）；Enter 或 Tab 结束并选中这张图片，Esc 放弃本次修改，
    焦点离开时也结束。结束时图注有变化才产生一个事务，Cmd+Z 可以撤销；编辑中的 Cmd+Z 是文本框自己的撤销。
  - 插入图片时图注为空，不用文件名代替。行内图片没有图注。
- `serializeChapter` 的结果再次解析后结构与文字不变；Markdown 无法表达的格式在写出时调整或去掉，文字永远不变。
- 图片节点只保存正文中的原始引用；显示地址不进入文档，远程与项目外的地址不加载。
- 编辑环境主题来自应用级偏好，以展示参数作用在组件上：不改变文档、不产生 change、不进入正文撤销历史、不重建视图。
  不读取项目样式，不影响 Word / PDF 输出；默认提供美观、易读的内容展示。
- 图片按统一展示规则适应编辑区域；不提供单张图片的尺寸 / 对齐 / 位置控制，不保存局部布局状态，不发出 `image-layout`。
  图片插入、选择、删除与正文撤销仍属于内容编辑能力。
  行内图片（含表格单元格中的长图）也应有统一的展示高度上限，保持比例、不裁切，
  不允许单张超长图片无限撑高内容区；具体上限及查看原图方式在编辑环境设计时确定，
  不沿用 PDF 的页面高度，也不写入项目。

## 内容契约测试

`markdown.test.ts` 负责 ProseMirror 转换与往返；Rust `render::markdown` 测试负责输出中间模型。
共享 Markdown 语义 fixture（`markdown_contract.test.ts` 与 Rust `render::contract_tests`）以入库的 `.serialized.md` golden 连接两端：
Vitest 用 `await expect(output).toMatchFileSnapshot(path)` 验证实际 `serialize(parse(input))` 输出，
通过自带 `-u` 更新 golden，不新增更新脚本或开关；默认配置使用 `update: 'none'` 或等效选项，
保证默认测试运行只读，缺失文件也失败。Rust 读取原文与 golden，分别验证预期 IR；更新后两侧都需通过，
预期语义单独审查，不随 golden 自动改写。具体流程见 decisions 第 8 节。
共享资产放在 `src-tauri/fixtures/`，使用中立 JSON 块树作为预期语义，双方测试各自投影后比较；
用例组织与语义格式见 decisions 第 8 节“实施”一项；它们不成为产品模型或运行时协议。
至少覆盖 figure / 行内图片、图注、表格、列表、标题（作为文字）、中文强调、HTML 与换行；
比较预期内容与结构，不要求内部节点类型或 Markdown 字节完全相同。
这些验证在移除预览后继续保留，不引入自定义 Vue SFC 加载器，也无需运行时串联 TS 与 Rust。

## 编辑环境主题

旧的图片布局插件、布局按钮 / 菜单与文档主题绑定已移除。编辑环境主题的入口属于编辑环境设置，
偏好由应用状态保存，不通过 `ProjectSession` 修改文档；可调整项与界面交互另行设计，
实施时按 UI 准则更新 Story 并进行界面验收。

## 非目标

不支持 Markdown 无法保存的结构（合并单元格、单元格内多段落、列宽、文字颜色等）；不提供 Markdown 源码编辑模式。
不提供分页预览。全文阅读是独立的只读视图（`ui/reader/`），与编辑器共用正文样式（`document_body.css`）；
编辑器只为它提供阅读位置的读取与恢复（`readingPosition` / `revealPosition`），不承担连续阅读与章节同步。
