/**
 * 拖拽落点判定。
 *
 * 只做一件事：根据指针的纵向位置和目标章节行的位置，把落点归一为三个区域。
 * 行的上 1/3 为 before、中间 1/3 为 inside、下 1/3 为 after。
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
  if (pointerY < row.top + row.height / 3) return 'before'
  if (pointerY < row.top + (row.height * 2) / 3) return 'inside'
  return 'after'
}
