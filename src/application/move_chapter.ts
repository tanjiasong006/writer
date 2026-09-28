import {
  moveChapter,
  validateMove,
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
  const plan = resolveTarget(tree, intent)
  if ('reason' in plan) return { ok: false, reason: plan.reason }
  return moveChapter(tree, intent.chapterId, plan.targetParentId, plan.index)
}

/**
 * 判断一次拖拽意图是否会真正改变章节树，供 UI 决定是否显示可放置反馈。
 *
 * 纯校验：只读入参 tree，不构造也不修改任何新树；真正的树修改由 drop 后的 moveChapterTo 执行。
 *
 * 以下情况返回 false：
 * - 被移动章节或目标章节不存在；
 * - 目标是自身或自身后代（成环）；
 * - 落点换算后的位置与当前位置相同（no-op）。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function canMoveChapter(tree: ChapterTree, intent: MoveIntent): boolean {
  const plan = resolveTarget(tree, intent)
  if ('reason' in plan) return false
  // 摘下来再插回同一位置：没有实际位移，不显示放置反馈。
  if (plan.targetParentId === plan.moving.parentId && plan.index === plan.moving.index) return false
  // 存在性、成环、越界等移动规则只有 Domain 一份，这里只做无副作用的只读校验。
  return validateMove(tree, intent.chapterId, plan.targetParentId, plan.index) === null
}

/** 键盘移动方向：同级上移 / 下移，提升为父章节的下一个兄弟，降级为上一个兄弟的最后一个子章节。 */
export type KeyboardMoveDirection = 'up' | 'down' | 'outdent' | 'indent'

/**
 * 把键盘移动（known-risks #2）换算成与拖拽相同的 MoveIntent，之后仍由 moveChapterTo 执行。
 *
 * - up：放到上一个兄弟之前；down：放到下一个兄弟之后。
 * - outdent：放到父章节之后；indent：放进上一个兄弟，作为最后一个子章节。
 * - 没有对应的兄弟 / 父章节（已在边界）或章节不存在时返回 null。
 * - 层级上限等移动规则不在这里判断，由 moveChapterTo 返回原因。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function keyboardMoveIntent(
  tree: ChapterTree,
  chapterId: ChapterId,
  direction: KeyboardMoveDirection,
): MoveIntent | null {
  const location = locate(tree, chapterId)
  if (!location) return null
  const siblings = location.parentId === null ? tree : (locate(tree, location.parentId)?.node.children ?? [])
  const previous = siblings[location.index - 1]
  const next = siblings[location.index + 1]

  switch (direction) {
    case 'up':
      return previous ? { chapterId, targetChapterId: previous.id, position: 'before' } : null
    case 'down':
      return next ? { chapterId, targetChapterId: next.id, position: 'after' } : null
    case 'outdent':
      return location.parentId === null
        ? null
        : { chapterId, targetChapterId: location.parentId, position: 'after' }
    case 'indent':
      return previous ? { chapterId, targetChapterId: previous.id, position: 'inside' } : null
  }
}

type TargetPlan = {
  readonly moving: Location
  readonly targetParentId: ChapterId | null
  readonly index: number
}

/** 把意图换算成 Domain 需要的 (targetParentId, index)；无法定位时给出原因。 */
function resolveTarget(tree: ChapterTree, intent: MoveIntent): TargetPlan | { reason: MoveReason } {
  const moving = locate(tree, intent.chapterId)
  if (!moving) return { reason: 'chapter-not-found' }

  const target = locate(tree, intent.targetChapterId)
  if (!target) return { reason: 'target-not-found' }

  let targetParentId: ChapterId | null
  let index: number

  if (intent.position === 'inside') {
    targetParentId = intent.targetChapterId
    index = target.node.children.length
  } else {
    targetParentId = target.parentId
    index = target.index + (intent.position === 'after' ? 1 : 0)
  }

  // 摘下来再插回去：同父且原位置在插入点之前，移除后下标会前移一位。
  if (targetParentId === moving.parentId && moving.index < index) index -= 1

  return { moving, targetParentId, index }
}

interface Location {
  readonly parentId: ChapterId | null
  readonly index: number
  readonly node: ChapterNode
}

function locate(tree: ChapterTree, id: ChapterId): Location | null {
  const visit = (list: ChapterTree, parentId: ChapterId | null): Location | null => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { parentId, index: i, node: list[i] }
      const hit = visit(list[i].children, list[i].id)
      if (hit) return hit
    }
    return null
  }
  return visit(tree, null)
}
