# document

## 职责

表达一份文档：文档信息（标题、副标题、作者）、章节树、每个章节的正文，并维护"正文与章节一一对应"。纯逻辑，不涉及存储格式、UI 或视觉排版配置。

## 数据结构

```ts
interface WriterDocument {
  readonly title: string
  readonly subtitle: string   // 空串表示没有
  readonly author: string     // 空串表示没有
  readonly tree: ChapterTree
  readonly contents: ReadonlyMap<ChapterId, string>   // 正文，不含章节标题、编号与排版信息
}
```

## 输入输出

- `createDocument(title, tree, contents)`：从存储加载时组装；缺正文 `content-missing`、
  多出正文 `content-orphan`，显式失败，不悄悄补齐或丢弃。
- `emptyDocument(title)`：没有章节的新文档。
- `createDocument` 与 `emptyDocument` 得到的文档没有副标题与作者；从存储加载时再用 `setDocumentInfo` 设置。
- `replaceTree(doc, tree)`：结构操作（在 chapter_tree 中完成）之后同步正文：
  删除的章节去掉正文，新章节补空正文，其余原样保留。
- `setContent(doc, id, text)` / `setTitle(doc, title)` / `setDocumentInfo(doc, { title, subtitle, author })`：
  内容不变时返回同一对象。文档信息是文档内容，Word 与 PDF 都会输出。
- `hasContent(doc, id)`：正文是否有非空白内容；UI 据此决定删除是否需要确认（ui-spec §23）。

## 不变量

- `contents` 的 key 集合 = `tree` 中的 id 集合。
- 纯函数，不修改输入。

## 非目标

文件名、manifest 格式属于 infrastructure `project_format`；保存与 dirty 状态属于 Application。
编辑环境主题属于应用偏好；Word 输出样式与 PDF 排版配置不属于 `WriterDocument`。
图片引用与图注属于正文，单张图片尺寸、对齐、位置不进入文档模型。
