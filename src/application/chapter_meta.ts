import {
  setChapterMeta as setChapterMetaInTree,
  type ChapterId,
  type ChapterStatus,
  type ChapterTree,
  type RenameResult,
} from '../domain/chapter_tree/chapter_tree.ts'

/**
 * 修改章节的写作状态与备注（docs/decisions.md 第 16 节）：Application 用例。UI 通过它修改树。
 * status 为 null 去掉状态，备注为空白时去掉备注；不提供的项不变。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function setChapterMeta(
  tree: ChapterTree,
  chapterId: ChapterId,
  meta: { readonly status?: ChapterStatus | null; readonly note?: string },
): RenameResult {
  return setChapterMetaInTree(tree, chapterId, meta)
}
