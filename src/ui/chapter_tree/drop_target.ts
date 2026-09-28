/**
 * 拖拽落点判定。
 *
 * 只做一件事：根据指针的纵向位置和目标章节行的位置，把落点归一为三个区域。
 * 行的上 25% 为 before、中间 50% 为 inside、下 25% 为 after。
 * inside 区域更大，因为 before / after 需要精确位置，而 inside 应该容易命中。
 *
 * 纯函数，不依赖 DOM 与 Vue；row 的位置由调用方用 getBoundingClientRect 取得，
 * 与 pointerY 使用同一坐标系（如 clientY）。
 */

export type DropPosition = 'before' | 'inside' | 'after'

/** 目标行的纵向位置；top 与 height 与 pointerY 同属一个坐标系。 */
export interface DropTargetRow {
  readonly top: number
  readonly height: number
}

export function resolveDropPosition(pointerY: number, row: DropTargetRow): DropPosition {
  if (pointerY < row.top + row.height * 0.25) return 'before'
  if (pointerY < row.top + row.height * 0.75) return 'inside'
  return 'after'
}

/** 拖拽时靠近滚动区域边缘多少像素开始自动滚动。 */
export const AUTO_SCROLL_EDGE = 40
/** 每次 dragover 最多滚动的像素（dragover 约每 50ms 触发一次）。 */
export const AUTO_SCROLL_MAX_STEP = 16

/**
 * 拖拽自动滚动：指针距滚动区域上 / 下边缘不足 AUTO_SCROLL_EDGE 时返回滚动量（越靠近边缘越快），
 * 向上为负；其余位置返回 0。container 与 pointerY 使用同一坐标系。
 */
export function autoScrollStep(pointerY: number, container: DropTargetRow): number {
  const fromTop = pointerY - container.top
  const fromBottom = container.top + container.height - pointerY
  const speed = (distance: number) =>
    Math.ceil(AUTO_SCROLL_MAX_STEP * (1 - Math.max(distance, 0) / AUTO_SCROLL_EDGE))
  if (fromTop < AUTO_SCROLL_EDGE) return -speed(fromTop)
  if (fromBottom < AUTO_SCROLL_EDGE) return speed(fromBottom)
  return 0
}
