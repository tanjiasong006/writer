import {
  moveChapter,
  type ChapterId,
  type ChapterNode,
  type ChapterTree,
  type MoveReason,
} from '../domain/chapter_tree/chapter_tree.ts'

/** 拖拽落点，与 UI drop_target 的 DropPosition 对齐。 */
export type MovePosition = 'before' | 'inside' | 'after'

/** ChapterTree 松手时发出的移动意图：只描述“把谁放到哪”，不含章节树规则。 */
export interface MoveIntent {
  readonly chapterId: ChapterId
  readonly targetChapterId: ChapterId
  readonly position: MovePosition
}

/** 移动结果：成功时给出新的可信树，失败时给出原因。 */
export type MoveChapterResult =
  | { readonly ok: true; readonly tree: ChapterTree }
  | { readonly ok: false; readonly reason: MoveReason }

/**
 * 把拖拽移动意图转换成 Domain moveChapter 需要的 (targetParentId, index) 并执行。
 *
 * - before / after：放到目标章节的前 / 后一个兄弟位置。
 * - inside：放进目标章节，作为最后一个子章节。
 * - moveChapter 的 index 以“移除被移动章节之后”为准，所以同父且原位置在插入点之前时，index 前移一位。
 * - 章节树移动规则（成环、越界等）全部由 Domain 负责，这里只做坐标换算。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function moveChapterTo(tree: ChapterTree, intent: MoveIntent): MoveChapterResult {
  const moving = locate(tree, intent.chapterId)
  if (!moving) return { ok: false, reason: 'chapter-not-found' }

  const target = locate(tree, intent.targetChapterId)
  if (!target) return { ok: false, reason: 'target-not-found' }

  let targetParentId: ChapterId | null
  let index: number

  if (intent.position === 'inside') {
    targetParentId = intent.targetChapterId
    index = findNode(tree, targetParentId)?.children.length ?? 0
  } else {
    targetParentId = target.parentId
    index = target.index + (intent.position === 'after' ? 1 : 0)
  }

  // 摘下来再插回去：同父且原位置在插入点之前，移除后下标会前移一位。
  if (targetParentId === moving.parentId && moving.index < index) index -= 1

  return moveChapter(tree, intent.chapterId, targetParentId, index)
}

interface Location {
  readonly parentId: ChapterId | null
  readonly index: number
}

function locate(tree: ChapterTree, id: ChapterId): Location | null {
  const visit = (list: ChapterTree, parentId: ChapterId | null): Location | null => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { parentId, index: i }
      const hit = visit(list[i].children, list[i].id)
      if (hit) return hit
    }
    return null
  }
  return visit(tree, null)
}

function findNode(list: ChapterTree, id: ChapterId): ChapterNode | null {
  for (const node of list) {
    if (node.id === id) return node
    const hit = findNode(node.children, id)
    if (hit) return hit
  }
  return null
}
