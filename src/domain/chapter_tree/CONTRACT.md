# chapter_tree

## 职责

定义章节树的数据结构，并校验一棵树是否合法。纯逻辑，不涉及 UI、存储、导入导出。

## 数据结构

```ts
type ChapterId = string

interface ChapterNode {
  id: ChapterId
  title: string
  children: ChapterNode[]
}

type ChapterTree = ChapterNode[]
```

## 输入输出

```ts
validateTree(tree: unknown): ValidateTreeResult

interface TreeIssue {
  path: string   // 出问题的位置，如 "[0].children[1]"；根为 "root"
  message: string
}

type ValidateTreeResult =
  | { ok: true; tree: ChapterTree }
  | { ok: false; issues: TreeIssue[] }
```

成功时返回 `ok: true` 和可信的 `ChapterTree`；失败时返回 `ok: false` 和全部 `issues`。
输入为 `unknown`，因为树常来自外部数据（文件、导入、粘贴），需在信任边界上做运行时检查。

## 不变量

- `ChapterId` 全局唯一且为非空字符串。
- 每个节点为对象，含字符串 `title` 和数组 `children`。
- 是一棵真正的树：无循环引用、无共享节点，可安全遍历。

## 非目标

移动、新增、删除、编号、UI、持久化均不在此模块。
