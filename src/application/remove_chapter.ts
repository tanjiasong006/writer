import {
  insertChapter,
  removeChapter as removeChapterInTree,
  type ChapterId,
  type ChapterNode,
  type ChapterTree,
  type InsertResult,
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

/** 被删除的章节（连同子树）与它原来的位置：撤销删除时放回这里。 */
export interface RemovedChapter {
  readonly node: ChapterNode
  /** 原来的父章节；null 表示根层级。 */
  readonly parentId: ChapterId | null
  /** 原来在兄弟中的位置。 */
  readonly index: number
}

/**
 * 删除前记录章节的位置；找不到章节时为 null。
 *
 * 前置条件：tree 是删除前的可信树。
 */
export function describeRemoval(tree: ChapterTree, chapterId: ChapterId): RemovedChapter | null {
  const visit = (siblings: ChapterTree, parentId: ChapterId | null): RemovedChapter | null => {
    const index = siblings.findIndex((node) => node.id === chapterId)
    if (index >= 0) return { node: siblings[index], parentId, index }
    for (const node of siblings) {
      const found = visit(node.children, node.id)
      if (found) return found
    }
    return null
  }
  return visit(tree, null)
}

/**
 * 撤销删除：把章节（连同子树）放回原来的父章节、原来的位置。
 * 之后的其他结构修改不受影响：原父章节已不存在时放到根层级末尾，原位置超出现有兄弟数量时放到末尾。
 *
 * 前置条件：tree 是一棵可信树；removed 来自 describeRemoval，其中的章节不在 tree 中。
 */
export function restoreRemovedChapter(tree: ChapterTree, removed: RemovedChapter): InsertResult {
  const parent = removed.parentId === null ? null : findParent(tree, removed.parentId)
  const siblings = parent === null ? tree : parent.children
  const parentId = parent === null ? null : parent.id
  const index = parent === null && removed.parentId !== null ? siblings.length : Math.min(removed.index, siblings.length)
  return insertChapter(tree, parentId, index, removed.node)
}

function findParent(tree: ChapterTree, id: ChapterId): ChapterNode | null {
  for (const node of tree) {
    if (node.id === id) return node
    const found = findParent(node.children, id)
    if (found) return found
  }
  return null
}
