export type ChapterId = string

export interface ChapterNode {
  id: ChapterId
  title: string
  children: ChapterNode[]
}

export type ChapterTree = ChapterNode[]

/** 校验问题的机器可读代码。面向用户的文案由 UI 层根据 code 生成。 */
export type TreeIssueCode =
  | 'not-an-array'
  | 'node-not-object'
  | 'node-reused'
  | 'id-invalid'
  | 'id-duplicate'
  | 'title-invalid'
  | 'children-invalid'

/** 一条校验问题。path 指向出问题的位置，code 说明原因。 */
export interface TreeIssue {
  path: string
  code: TreeIssueCode
}

/**
 * 校验结果：成功时给出可信的 ChapterTree，失败时给出全部问题。
 * 判别字段是 ok。
 */
export type ValidateTreeResult =
  | { ok: true; tree: ChapterTree }
  | { ok: false; issues: TreeIssue[] }

/**
 * 校验一棵章节树。
 *
 * 输入声明为 unknown，因为章节树常来自外部数据（文件、粘贴、导入），
 * 必须在信任边界上做运行时结构检查。只有校验通过才会返回 ok: true，
 * 此时 tree 可被当作可信的 ChapterTree 使用。
 */
export function validateTree(tree: unknown): ValidateTreeResult {
  const issues: TreeIssue[] = []
  const seenIds = new Set<string>()
  const seenNodes = new WeakSet<object>()

  const visit = (node: unknown, path: string): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      issues.push({ path, code: 'node-not-object' })
      return
    }

    // 同一对象被再次遇到 = 循环引用或共享节点，继续递归会无限展开。
    if (seenNodes.has(node)) {
      issues.push({ path, code: 'node-reused' })
      return
    }
    seenNodes.add(node)

    const n = node as Record<string, unknown>

    if (typeof n.id !== 'string' || n.id.length === 0) {
      issues.push({ path, code: 'id-invalid' })
    } else if (seenIds.has(n.id)) {
      issues.push({ path, code: 'id-duplicate' })
    } else {
      seenIds.add(n.id)
    }

    if (typeof n.title !== 'string') {
      issues.push({ path, code: 'title-invalid' })
    }

    if (!Array.isArray(n.children)) {
      issues.push({ path, code: 'children-invalid' })
      return
    }

    n.children.forEach((child, i) => visit(child, `${path}.children[${i}]`))
  }

  if (!Array.isArray(tree)) {
    return { ok: false, issues: [{ path: 'root', code: 'not-an-array' }] }
  }

  tree.forEach((node, i) => visit(node, `[${i}]`))

  // 唯一的类型断言点：走到这里结构已全部校验通过，树可信。
  return issues.length === 0
    ? { ok: true, tree: tree as ChapterTree }
    : { ok: false, issues }
}

export type MoveReason =
  | 'chapter-not-found'
  | 'target-not-found'
  | 'target-is-descendant'
  | 'index-out-of-range'

/** 移动结果：成功时给出新的可信树，失败时给出原因。 */
export type MoveResult =
  | { ok: true; tree: ChapterTree }
  | { ok: false; reason: MoveReason }

/**
 * 把一个章节（连同其子树）移动到 targetParentId 下的第 index 个位置。
 *
 * - targetParentId 为 null 表示移动到根层级。
 * - index 是**移除该章节之后**目标父节点 children 中的下标。
 *   移动即“摘下来再插回去”，因此同层移动不会受原位置影响。
 * - 纯函数：不修改传入的 tree，返回一棵新树。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function moveChapter(
  tree: ChapterTree,
  chapterId: ChapterId,
  targetParentId: ChapterId | null,
  index: number,
): MoveResult {
  const chapter = findNode(tree, chapterId)
  if (!chapter) return { ok: false, reason: 'chapter-not-found' }

  if (targetParentId !== null && !findNode(tree, targetParentId)) {
    return { ok: false, reason: 'target-not-found' }
  }

  // 移到自身或自己的子树里会形成环，也会把整棵子树从树上摘下来。
  if (targetParentId !== null && containsId(chapter, targetParentId)) {
    return { ok: false, reason: 'target-is-descendant' }
  }

  const [without, removed] = removeNode(tree, chapterId)
  if (!removed) return { ok: false, reason: 'chapter-not-found' }

  const targetLength =
    targetParentId === null
      ? without.length
      : (findNode(without, targetParentId)?.children.length ?? 0)

  if (!Number.isInteger(index) || index < 0 || index > targetLength) {
    return { ok: false, reason: 'index-out-of-range' }
  }

  const next =
    targetParentId === null
      ? spliceAt(without, index, removed)
      : insertNode(without, targetParentId, index, removed)

  return { ok: true, tree: next }
}

function findNode(list: ChapterNode[], id: ChapterId): ChapterNode | null {
  for (const node of list) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return null
}

function containsId(node: ChapterNode, id: ChapterId): boolean {
  return node.id === id || node.children.some((child) => containsId(child, id))
}

function spliceAt(list: ChapterNode[], index: number, node: ChapterNode): ChapterNode[] {
  const next = list.slice()
  next.splice(index, 0, node)
  return next
}

/** 摘掉 id 对应的节点，返回新树和摘掉的节点；沿途节点重建，不修改原树。 */
function removeNode(
  list: ChapterNode[],
  id: ChapterId,
): [ChapterNode[], ChapterNode | null] {
  let removed: ChapterNode | null = null
  const next: ChapterNode[] = []
  for (const node of list) {
    if (node.id === id) {
      removed = node
      continue
    }
    const [children, childRemoved] = removeNode(node.children, id)
    if (childRemoved) removed = childRemoved
    next.push({ ...node, children })
  }
  return [next, removed]
}

function insertNode(
  list: ChapterNode[],
  parentId: ChapterId,
  index: number,
  node: ChapterNode,
): ChapterNode[] {
  return list.map((current) =>
    current.id === parentId
      ? { ...current, children: spliceAt(current.children, index, node) }
      : { ...current, children: insertNode(current.children, parentId, index, node) },
  )
}
