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
| `chapter_documents.ts` | 应用状态 ⇄ 编辑器状态的适配：每章节一个 EditorState，决定何时产生新正文。 |
| `image_view.ts` | 图片节点视图：按项目资源显示，无法显示时占位。 |
| `ChapterEditor.vue` / `EditorToolbar.vue` | 挂载 EditorView、响应章节切换、发出 change、展示工具栏。 |

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
- `serializeChapter` 的结果再次解析后结构与文字不变；Markdown 无法表达的格式在写出时调整或去掉，文字永远不变。
- 图片节点只保存正文中的原始引用；显示地址不进入文档，远程与项目外的地址不加载。

## 非目标

不支持 Markdown 无法保存的结构（合并单元格、单元格内多段落、列宽、文字颜色等）；不提供 Markdown 源码编辑模式。
