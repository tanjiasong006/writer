# document

## 职责

表达一份文档：标题、章节树、每个章节的正文，并维护"正文与章节一一对应"。纯逻辑，不涉及存储格式、UI。

## 数据结构

```ts
interface WriterDocument {
  readonly title: string
  readonly tree: ChapterTree
  readonly contents: ReadonlyMap<ChapterId, string>   // 正文，不含章节标题与编号
}
```

## 输入输出

- `createDocument(title, tree, contents)`：从存储加载时组装；缺正文 `content-missing`、
  多出正文 `content-orphan`，显式失败，不悄悄补齐或丢弃。
- `emptyDocument(title)`：没有章节的新文档。
- `replaceTree(doc, tree)`：结构操作（在 chapter_tree 中完成）之后同步正文：
  删除的章节去掉正文，新章节补空正文，其余原样保留。
- `setContent(doc, id, text)` / `setTitle(doc, title)`：内容不变时返回同一对象。
- `isChapterBlank(doc, id)`：无子章节且正文只含空白；用于"空白章节删除无需确认"。

## 不变量

- `contents` 的 key 集合 = `tree` 中的 id 集合。
- 纯函数，不修改输入。

## 非目标

文件名、manifest 格式属于 infrastructure `project_format`；保存与 dirty 状态属于 Application。
