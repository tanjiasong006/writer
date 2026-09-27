import {
  removeChapter as removeChapterInTree,
  type ChapterId,
  type ChapterTree,
  type RemoveResult,
} from '../domain/chapter_tree/chapter_tree.ts'

/** 删除结果：与 Domain 的 RemoveResult 相同。 */
export type RemoveChapterResult = RemoveResult

/**
 * 删除章节及其整棵子树：Application 用例。UI 通过它修改树，不直接调用 Domain。
 * “删除前必须确认”属于 UI 交互，不在 Application 里重复表达。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function removeChapter(tree: ChapterTree, chapterId: ChapterId): RemoveChapterResult {
  return removeChapterInTree(tree, chapterId)
}
