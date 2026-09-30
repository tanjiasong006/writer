/**
 * 章节正文中的阅读位置：视口顶端所在的顶层块（段落、列表、表格、图片……）及其相对视口顶端的偏移。
 *
 * 编辑器与全文阅读用同一套正文样式（document_body.css）、同样的版心宽度，同一个块在两处高度相同；
 * 在两者之间切换时按块序号与偏移对齐，眼前的文字停在原处。
 */
export interface BlockPosition {
  /** 顶层块的序号；-1 表示章节标题（正文之前）。 */
  readonly block: number
  /** 块的上边缘相对视口顶端的距离（像素）；块已部分滚出顶端时为负。 */
  readonly offset: number
}

/**
 * 视口顶端所在的块：第一个下边缘低于 viewportTop 的块（按文档顺序排列，位置单调递增，二分查找）。
 * 所有块都已滚过视口顶端（正文之后的留白）时是最后一个块；没有块时返回 null。
 * 坐标都是 getBoundingClientRect 的视口坐标。
 */
export function topBlock(blocks: ArrayLike<Element>, viewportTop: number): BlockPosition | null {
  let low = 0
  let high = blocks.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (blocks[middle].getBoundingClientRect().bottom > viewportTop) high = middle
    else low = middle + 1
  }
  if (blocks.length === 0) return null
  const block = Math.min(low, blocks.length - 1)
  return { block, offset: blocks[block].getBoundingClientRect().top - viewportTop }
}
