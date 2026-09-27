import {
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
