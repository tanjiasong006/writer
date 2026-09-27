# chapter_tree

## 职责

定义章节树的数据结构，校验一棵树是否合法，并提供移动、新增、删除、重命名章节的操作。纯逻辑，不涉及 UI、存储、导入导出。

失败原因一律用机器可读的 `code` 表达，不包含面向用户的自然语言；文案由 UI 层负责。

数据默认 readonly，状态变化一律通过生成新数据表达，不原地修改。

外部数据在进入 Domain 前用 `validateTree` 校验；进入 Domain 后信任 TypeScript 类型，不再重复做结构校验，只在类型表达不了的语义约束上返回错误（如 id 唯一、target 存在、index 范围）。

## 数据结构

```ts
type ChapterId = string

interface ChapterNode {
  readonly id: ChapterId
  readonly title: string
  readonly children: readonly ChapterNode[]
}

type ChapterTree = readonly ChapterNode[]
```

## 输入输出

```ts
validateTree(tree: unknown): ValidateTreeResult

type TreeIssueCode =
  | 'not-an-array'
  | 'node-not-object'
  | 'node-reused'
  | 'id-invalid'
  | 'id-duplicate'
  | 'title-invalid'
  | 'children-invalid'

interface TreeIssue {
  readonly path: string   // 出问题的位置，如 "[0].children[1]"；根为 "root"
  readonly code: TreeIssueCode
}

type ValidateTreeResult =
  | { readonly ok: true; readonly tree: ChapterTree }
  | { readonly ok: false; readonly issues: readonly TreeIssue[] }
```

成功时返回 `ok: true` 和可信的 `ChapterTree`；失败时返回 `ok: false` 和全部 `issues`。
输入为 `unknown`，因为树常来自外部数据（文件、导入、粘贴），需在信任边界上做运行时检查。

`issues` 只给机器可读的 `code` 和 `path`，不含面向用户的文案；文案由 UI 层根据 `code` 生成。

### moveChapter

```ts
moveChapter(
  tree: ChapterTree,          // 已通过 validateTree 的可信树
  chapterId: ChapterId,       // 要移动的章节
  targetParentId: ChapterId | null,  // null 表示根层级
  index: number,              // 移除该章节后，目标父节点 children 中的下标
): MoveResult

type MoveReason =
  | 'chapter-not-found'
  | 'target-not-found'
  | 'target-is-descendant'   // 目标是自己或自己的子孙，会成环/丢子树
  | 'index-out-of-range'     // 非整数，或不在 0..长度 内

type MoveResult =
  | { readonly ok: true; readonly tree: ChapterTree }
  | { readonly ok: false; readonly reason: MoveReason }
```

纯函数：不修改传入的 `tree`，返回新树。移动即“摘下来再插回去”，因此同层移动的 `index` 按移除后的位置理解，不受原位置影响。

这是移动的最小原语；上移/下移/拖放到某节点前后等行为由上层根据它组合。

### insertChapter

```ts
insertChapter(
  tree: ChapterTree,          // 已通过 validateTree 的可信树
  parentId: ChapterId | null, // null 表示根层级
  index: number,              // 插入位置，0..目标 children 当前长度（等于长度即追加）
  node: ChapterNode,          // 完整的待插入节点（含子树）
): InsertResult

type InsertReason =
  | 'parent-not-found'
  | 'index-out-of-range'
  | 'id-duplicate'    // node 或其子树的 id 与树中已有 id 冲突

type InsertResult =
  | { readonly ok: true; readonly tree: ChapterTree }
  | { readonly ok: false; readonly reason: InsertReason }
```

纯函数：不修改传入的 `tree`。`node` 按 `ChapterNode` 类型信任，不再做结构校验；其 id 不能与树中已有 id 重复（该语义约束类型表达不了，仍要检查）。

### removeChapter

```ts
removeChapter(tree: ChapterTree, chapterId: ChapterId): RemoveResult

type RemoveReason = 'chapter-not-found'

type RemoveResult =
  | { readonly ok: true; readonly tree: ChapterTree }
  | { readonly ok: false; readonly reason: RemoveReason }
```

删除章节及其整棵子树，纯函数。允许删到空树（空树合法）。

### renameChapter

```ts
renameChapter(tree: ChapterTree, chapterId: ChapterId, title: string): RenameResult

type RenameReason = 'chapter-not-found' | 'title-invalid'

type RenameResult =
  | { readonly ok: true; readonly tree: ChapterTree }
  | { readonly ok: false; readonly reason: RenameReason }
```

只改 `title`，不动 id、children 和位置，纯函数。空字符串是合法 `title`（不变量只要求是字符串）。

## 不变量

- `ChapterId` 全局唯一且为非空字符串。
- 每个节点为对象，含字符串 `title` 和数组 `children`。
- 是一棵真正的树：无循环引用、无共享节点，可安全遍历。

## 非目标

编号、UI、持久化均不在此模块。
