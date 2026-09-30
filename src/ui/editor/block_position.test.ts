import { expect, test } from 'vitest'
import { topBlock } from './block_position.ts'

/** 按上下边缘给出位置的块（视口坐标）。 */
function blocks(...spans: Array<[number, number]>): Element[] {
  return spans.map(([top, bottom]) => ({ getBoundingClientRect: () => ({ top, bottom }) }) as Element)
}

test('视口顶端所在的块：第一个下边缘低于顶端的块，偏移为它的上边缘相对顶端的距离', () => {
  const list = blocks([0, 100], [120, 200], [220, 400])
  expect(topBlock(list, 50)).toEqual({ block: 0, offset: -50 })
  expect(topBlock(list, 100)).toEqual({ block: 1, offset: 20 }) // 两块之间的空白属于下一块
  expect(topBlock(list, 300)).toEqual({ block: 2, offset: -80 })
})

test('所有块都已滚过顶端时是最后一个块；没有块时为 null', () => {
  expect(topBlock(blocks([0, 100], [120, 200]), 500)).toEqual({ block: 1, offset: -380 })
  expect(topBlock([], 0)).toBeNull()
})
