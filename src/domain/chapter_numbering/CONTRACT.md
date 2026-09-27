# chapter_numbering

## 职责

根据 `ChapterTree` 的结构计算每个章节的层级编号。纯逻辑，不涉及 UI、存储、导入导出。

编号完全由章节在树中的位置推导，不读取也不写入 `ChapterNode`。同一个树结构永远得到同一组编号。

## 输入输出

```ts
type ChapterNumber = readonly number[]   // 从根到该章节的各级序号，从 1 开始

computeChapterNumbers(tree: ChapterTree): ReadonlyMap<ChapterId, ChapterNumber>
```

- `ChapterNumber` 只表达结构。`[1, 2]` 对应显示编号 "1.2"，具体显示格式（分隔符、样式）由 UI 层决定。
- 返回的 `Map` 覆盖树中每个章节，key 为 `ChapterId`。
- 空树返回空 `Map`。

例如：

```text
A            A → [1]
├─ B         B → [1, 1]
│  └─ C      C → [1, 1, 1]
└─ D         D → [1, 2]
E            E → [2]
```

## 不变量

- 纯函数：不修改传入的树，返回全新的 `Map`。
- 返回值与输入结构一一对应；同一父节点下的兄弟编号从 1 连续递增。
- 不依赖 `title`，只依赖位置。

## 非目标

UI、持久化、编号格式配置均不在此模块。显示格式（跳级、罗马数字、中文序号等）由 UI 层根据 `ChapterNumber` 生成。

`chapter_tree` 的行为不受本模块影响；本模块只读取它的公开类型。
