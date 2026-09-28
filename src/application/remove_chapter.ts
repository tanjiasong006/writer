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

/**
 * 删除 chapterId 之后应选中的章节：下一个兄弟，否则上一个兄弟，否则父章节；
 * 删除后树为空时为 null。让用户删除正在写的章节后可以直接继续写相邻章节。
 *
 * 前置条件：tree 是删除前的可信树。
 */
export function selectionAfterRemove(tree: ChapterTree, chapterId: ChapterId): ChapterId | null {
  const visit = (siblings: ChapterTree, parent: ChapterId | null): ChapterId | null | undefined => {
    const index = siblings.findIndex((node) => node.id === chapterId)
    if (index >= 0) return siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? parent
    for (const node of siblings) {
      const found = visit(node.children, node.id)
      if (found !== undefined) return found
    }
    return undefined
  }
  return visit(tree, null) ?? null
}
