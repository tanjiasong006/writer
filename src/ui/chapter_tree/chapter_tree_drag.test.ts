import { expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import ChapterTree from './ChapterTree.vue'
import type { ChapterTree as ChapterTreeModel } from '../../domain/chapter_tree/chapter_tree.ts'

const outline: ChapterTreeModel = [
  { id: 'a', title: 'A', children: [{ id: 'b', title: 'B', children: [] }] },
  { id: 'c', title: 'C', children: [] },
]

const ROW_HEIGHT = 30

/** happy-dom 不做布局，手动给行设置位置，才能算三等分。 */
function placeRow(element: Element, top: number): void {
  element.getBoundingClientRect = () =>
    ({
      top,
      height: ROW_HEIGHT,
      bottom: top + ROW_HEIGHT,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect
}

function mountWithRows() {
  const wrapper = mount(ChapterTree, { props: { tree: outline, selectedId: null } })
  const rows = wrapper.findAll('.chapter-tree__row')
  placeRow(rows[0].element, 0) // a: 0..30
  placeRow(rows[1].element, 30) // b: 30..60
  placeRow(rows[2].element, 60) // c: 60..90
  return { wrapper, rows }
}

function dropClasses(row: { classes: () => string[] }): string[] {
  return row.classes().filter((name) => name.startsWith('chapter-tree__row--drop'))
}

test('初始没有拖拽，也没有落点反馈', () => {
  const { wrapper } = mountWithRows()
  expect(wrapper.find('.chapter-tree__row--dragging').exists()).toBe(false)
  expect(wrapper.find('.chapter-tree__row--drop-before').exists()).toBe(false)
  expect(wrapper.find('.chapter-tree__row--drop-inside').exists()).toBe(false)
  expect(wrapper.find('.chapter-tree__row--drop-after').exists()).toBe(false)
})

test('dragstart 标记被拖动的行', async () => {
  const { wrapper, rows } = mountWithRows()
  await rows[0].trigger('dragstart')
  expect(rows[0].classes()).toContain('chapter-tree__row--dragging')
  expect(rows[1].classes()).not.toContain('chapter-tree__row--dragging')
})

test('拖到目标行上 1/3 显示 before 插入线', async () => {
  const { rows } = mountWithRows()
  await rows[0].trigger('dragstart')
  await rows[2].trigger('dragover', { clientY: 65 }) // c: 60..90，上 1/3
  expect(dropClasses(rows[2])).toEqual(['chapter-tree__row--drop-before'])
})

test('拖到目标行中间 1/3 高亮目标行（inside）', async () => {
  const { rows } = mountWithRows()
  await rows[0].trigger('dragstart')
  await rows[2].trigger('dragover', { clientY: 75 })
  expect(dropClasses(rows[2])).toEqual(['chapter-tree__row--drop-inside'])
})

test('拖到目标行下 1/3 显示 after 插入线', async () => {
  const { rows } = mountWithRows()
  await rows[0].trigger('dragstart')
  await rows[2].trigger('dragover', { clientY: 85 })
  expect(dropClasses(rows[2])).toEqual(['chapter-tree__row--drop-after'])
})

test('同一行内移动时落点实时切换', async () => {
  const { rows } = mountWithRows()
  await rows[0].trigger('dragstart')
  const target = rows[2]

  await target.trigger('dragover', { clientY: 65 })
  expect(dropClasses(target)).toEqual(['chapter-tree__row--drop-before'])

  await target.trigger('dragover', { clientY: 75 })
  expect(dropClasses(target)).toEqual(['chapter-tree__row--drop-inside'])

  await target.trigger('dragover', { clientY: 85 })
  expect(dropClasses(target)).toEqual(['chapter-tree__row--drop-after'])
})

test('移到另一行时旧反馈清除，只保留新行反馈', async () => {
  const { rows } = mountWithRows()
  await rows[0].trigger('dragstart')

  await rows[1].trigger('dragover', { clientY: 45 })
  expect(dropClasses(rows[1])).toEqual(['chapter-tree__row--drop-inside'])

  await rows[2].trigger('dragover', { clientY: 65 })
  expect(dropClasses(rows[1])).toEqual([])
  expect(dropClasses(rows[2])).toEqual(['chapter-tree__row--drop-before'])
})

test('dragleave 离开当前目标行后清除反馈', async () => {
  const { rows } = mountWithRows()
  await rows[0].trigger('dragstart')

  await rows[2].trigger('dragover', { clientY: 75 })
  await rows[2].trigger('dragleave')

  expect(dropClasses(rows[2])).toEqual([])
})

test('拖到自己身上不产生反馈', async () => {
  const { rows } = mountWithRows()
  await rows[0].trigger('dragstart')
  await rows[0].trigger('dragover', { clientY: 15 })
  expect(dropClasses(rows[0])).toEqual([])
})

test('从别的行拖回自己时清掉旧行反馈', async () => {
  const { rows } = mountWithRows()
  await rows[0].trigger('dragstart')

  await rows[2].trigger('dragover', { clientY: 75 })
  expect(dropClasses(rows[2])).toEqual(['chapter-tree__row--drop-inside'])

  await rows[0].trigger('dragover', { clientY: 15 })
  expect(dropClasses(rows[2])).toEqual([])
  expect(dropClasses(rows[0])).toEqual([])
})

test('drop 清除拖拽和落点状态', async () => {
  const { wrapper, rows } = mountWithRows()
  await rows[0].trigger('dragstart')
  await rows[2].trigger('dragover', { clientY: 75 })

  await rows[2].trigger('drop')

  expect(wrapper.find('.chapter-tree__row--dragging').exists()).toBe(false)
  expect(wrapper.find('.chapter-tree__row--drop-inside').exists()).toBe(false)
})

test('dragend 清除拖拽和落点状态', async () => {
  const { wrapper, rows } = mountWithRows()
  await rows[0].trigger('dragstart')
  await rows[2].trigger('dragover', { clientY: 85 })

  await rows[0].trigger('dragend')

  expect(wrapper.find('.chapter-tree__row--dragging').exists()).toBe(false)
  expect(wrapper.find('.chapter-tree__row--drop-after').exists()).toBe(false)
})

test('拖拽与落点反馈不修改章节树', async () => {
  const snapshot = JSON.stringify(outline)
  const { rows } = mountWithRows()
  await rows[0].trigger('dragstart')
  await rows[2].trigger('dragover', { clientY: 75 })
  await rows[2].trigger('drop')
  expect(JSON.stringify(outline)).toBe(snapshot)
})
