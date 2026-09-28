# editor

## 职责

章节正文的结构化编辑（ProseMirror）。正文在应用中始终是 Markdown 字符串（Domain `WriterDocument.contents`），
编辑器在 UI 层把它解析为 ProseMirror 文档、编辑后再写回 Markdown。Domain、Application、存储与 Rust 预览 / 导出不感知 ProseMirror。

## 模块

| 文件 | 职责 |
|---|---|
| `schema.ts` | 正文结构的权威定义。只包含 Markdown 能表达、Rust 渲染器能渲染的结构。 |
| `markdown.ts` | Markdown ⇄ 文档。`parseChapter` / `serializeChapter`（保持 CRLF、BOM、结尾换行）、`appendImage`。 |
| `commands.ts` | 编辑命令与工具栏状态（`toolbarState` 只从 EditorState 推导）。 |
| `plugins.ts` | 快捷键、输入规则、撤销历史、表格编辑、占位提示、剪贴板；`createEditorState`。 |
| `caret.ts` | 自绘文字光标：WebKit 原生光标在段落第二行起高度不对，改为按文字高度绘制（输入法组字期间用原生光标）。 |
| `selection.ts` | 自绘选区底色：WebKit 原生底色从段落中间开始选择时第一行偏高，改为每行一整行行高、行与行首尾相接。 |
| `figure_editing.ts` | 独立成段的图片（figure 节点）的编辑：Enter、Backspace / Delete，以及把只剩一张图片的段落转成 figure。 |
| `chapter_documents.ts` | 应用状态 ⇄ 编辑器状态的适配：每章节一个 EditorState，决定何时产生新正文。 |
| `image_view.ts` | 图片节点视图（figure 与行内图片）：按项目资源显示，无法显示时占位。 |
| `image_layout.ts` | 图片布局：插件状态（图片文件键 → 布局、主题默认）、figure 装饰、可撤销的 `ImageLayoutStep`。 |
| `ChapterEditor.vue` / `EditorToolbar.vue` / `ImageLayoutControls.vue` | 挂载 EditorView、响应章节切换、发出 change / image-layout、展示工具栏与图片布局按钮。`externalToolbar` 时工具栏由上层（工作区顶栏）显示：编辑器发出 `tools`（工具栏状态 + 选中的图片），通过 `runCommand` / `changeFigureLayout` 接受命令。 |

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
- 独占一段的 Markdown 图片在编辑器中是块级原子节点 figure（有布局），与文字同处一段、在表格单元格或标题中的是行内图片 image。
  光标不能停在 figure 旁边，文字（包括输入法）只会进入前后的段落。Markdown 不变：figure 写成与只含这张图片的段落相同的文字；
  编辑使段落只剩一张（不带链接的）图片时，它成为 figure，与预览 / 导出的判断一致。
- `serializeChapter` 的结果再次解析后结构与文字不变；Markdown 无法表达的格式在写出时调整或去掉，文字永远不变。
- 图片节点只保存正文中的原始引用；显示地址不进入文档，远程与项目外的地址不加载。
- 文档主题只以 CSS 变量作用在组件外层（`ui/document_style/theme_css.ts`）：不改变文档、不产生 change、不进入撤销历史、不重建视图。
- 图片布局不进入文档与 Markdown：由插件状态 + figure 上的装饰呈现；用户修改产生不改变文档的 `ImageLayoutStep`（进入撤销历史，
  选区不变），编辑器据此发出 `image-layout`；上层的布局 / 主题变化以不进入历史的同步事务回到插件状态（切换章节时同样同步）。

## 非目标

不支持 Markdown 无法保存的结构（合并单元格、单元格内多段落、列宽、文字颜色等）；不提供 Markdown 源码编辑模式。
