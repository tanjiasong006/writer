import {
  findChapter,
  insertChapter,
  type ChapterId,
  type ChapterNode,
  type ChapterTree,
  type InsertReason,
} from '../domain/chapter_tree/chapter_tree.ts'

/** 新建章节的结果：成功时返回新树和新章节 id，失败时给出原因。 */
export type CreateChapterResult =
  | { readonly ok: true; readonly tree: ChapterTree; readonly chapterId: ChapterId }
  | { readonly ok: false; readonly reason: InsertReason }

/**
 * 新建一个空章节：Application 生成新章节所需的数据（新的 id、空 children），
 * 再交由 Domain 的 insertChapter 插入到 parentId 下的第 index 个位置。
 *
 * - parentId 为 null 表示插入到根层级。
 * - index 是插入位置，范围 0..目标 children 当前长度。
 * - title 是章节的 Domain 数据，由上层提供，Application 只负责填入新节点。
 * - 不修改传入的 tree；章节树规则（父节点存在、index 范围、id 唯一）全部由 insertChapter 负责。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function createChapter(
  tree: ChapterTree,
  parentId: ChapterId | null,
  index: number,
  title: string,
): CreateChapterResult {
  const node: ChapterNode = { id: crypto.randomUUID(), title, children: [] }
  const result = insertChapter(tree, parentId, index, node)
  return result.ok
    ? { ok: true, tree: result.tree, chapterId: node.id }
    : { ok: false, reason: result.reason }
}

/**
 * 在 parentId 的末尾追加一个新章节（parentId 为 null 时追加到根层级）。
 *
 * 这是“新增章节”这一操作的完整用例：Application 负责把“追加”换算成具体 index，
 * UI 不需要为了取子节点数量而遍历树。
 */
export function appendChapter(
  tree: ChapterTree,
  parentId: ChapterId | null,
  title: string,
): CreateChapterResult {
  const index =
    parentId === null ? tree.length : (findChapter(tree, parentId)?.children.length ?? 0)
  return createChapter(tree, parentId, index, title)
}

/**
 * 在 siblingId 之后插入一个新章节（同父、紧邻其后）。
 *
 * “在某个章节之后”到 (parentId, index) 的换算属于 Application 的落点职责，
 * UI 只表达“在当前章节之后新建”，不自己定位父节点或算下标。
 * siblingId 不存在时复用 'parent-not-found'（其父也不存在）。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function createChapterAfter(
  tree: ChapterTree,
  siblingId: ChapterId,
  title: string,
): CreateChapterResult {
  const location = locateSibling(tree, siblingId, null)
  if (!location) return { ok: false, reason: 'parent-not-found' }
  return createChapter(tree, location.parentId, location.index + 1, title)
}

interface SiblingLocation {
  readonly parentId: ChapterId | null
  readonly index: number
}

/** 只读定位一个章节的相对位置（父节点与兄弟下标），不修改树。 */
function locateSibling(
  list: ChapterTree,
  id: ChapterId,
  parentId: ChapterId | null,
): SiblingLocation | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return { parentId, index: i }
    const hit = locateSibling(list[i].children, id, list[i].id)
    if (hit) return hit
  }
  return null
}
