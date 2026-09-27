import {
  renameChapter as renameChapterInTree,
  type ChapterId,
  type ChapterTree,
  type RenameResult,
} from '../domain/chapter_tree/chapter_tree.ts'

/** 重命名结果：与 Domain 的 RenameResult 相同。 */
export type RenameChapterResult = RenameResult

/**
 * 重命名章节：Application 用例。UI 通过它修改树，不直接调用 Domain。
 * 章节树规则（章节必须存在）全部由 Domain 负责。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function renameChapter(
  tree: ChapterTree,
  chapterId: ChapterId,
  title: string,
): RenameChapterResult {
  return renameChapterInTree(tree, chapterId, title)
}
