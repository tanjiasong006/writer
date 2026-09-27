import { expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import ChapterManager from './ChapterManager.vue'
import type { ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'

// a 有子章节 b；a、c 为根层相邻章节。
const outline: ChapterTree = [
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
  const wrapper = mount(ChapterManager, { props: { initialTree: outline, initialSelectedId: null } })
  const rows = wrapper.findAll('.chapter-tree__row')
  placeRow(rows[0].element, 0) // a
  placeRow(rows[1].element, 30) // b
  placeRow(rows[2].element, 60) // c
  return { wrapper, rows }
}

test('组合组件内拖拽移动章节仍然生效', async () => {
  const { wrapper, rows } = mountWithRows()

  await rows[0].trigger('dragstart') // a
  await rows[2].trigger('dragover', { clientY: 85 }) // c 下 1/3 → after
  await rows[2].trigger('drop')

  expect(wrapper.findAll('.chapter-tree__row').map((row) => row.text())).toEqual([
    '1C',
    '2A',
    '2.1B',
  ])
})

test('拖拽移动不改变当前选择', async () => {
  const { wrapper, rows } = mountWithRows()

  await rows[0].trigger('click')
  await rows[0].trigger('dragstart')
  await rows[2].trigger('dragover', { clientY: 85 })
  await rows[2].trigger('drop')

  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('2A')
})

test('把选中章节拖入已折叠的父节点：父节点展开且选中章节可见', async () => {
  const wrapper = mount(ChapterManager, {
    props: { initialTree: outline, initialSelectedId: 'c' },
  })

  // 折叠 a（它有子章节 b），此时可见行为 a、c。
  await wrapper.findAll('button.chapter-tree__toggle')[0].trigger('click')
  expect(wrapper.findAll('.chapter-tree__row').map((row) => row.text())).toEqual(['1A', '2C'])

  const rows = wrapper.findAll('.chapter-tree__row')
  placeRow(rows[0].element, 0) // a
  placeRow(rows[1].element, 30) // c

  await rows[1].trigger('dragstart') // c（当前选中）
  await rows[0].trigger('dragover', { clientY: 15 }) // a 中间 → inside
  await rows[0].trigger('drop')

  expect(wrapper.findAll('.chapter-tree__row').map((row) => row.text())).toEqual([
    '1A',
    '1.1B',
    '1.2C',
  ])
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1.2C')
})
