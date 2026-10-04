import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ChapterTree from './ChapterTree.vue'
import type { ChapterTree as ChapterTreeModel } from '../../domain/chapter_tree/chapter_tree.ts'
import { MIN_ROWS, OVERSCAN, rowWindow } from './use_row_window.ts'

test('rowWindow：可见区域加上下余量，不超出行数', () => {
  expect(rowWindow(1000, 32, 0, 320, 5)).toEqual({ start: 0, end: 15 })
  expect(rowWindow(1000, 32, 3200, 320, 5)).toEqual({ start: 95, end: 115 })
  expect(rowWindow(100, 32, 3000, 320, 5)).toEqual({ start: 88, end: 100 })
})

const many: ChapterTreeModel = Array.from({ length: 1000 }, (_, index) => ({ id: `c${index}`, title: `章${index}`, children: [] }))

/** happy-dom 没有布局：给滚动区域一个高度。 */
const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
function giveScrollerHeight(height: number): void {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('chapter-tree__scroll') ? height : 0
    },
  })
}
afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original)
})

function rowIds(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.chapter-tree__label').map((label) => label.attributes('data-chapter-id')!)
}

test('章节很多时只渲染可见区域附近的行与选中行；行按序号定位，列表保持全部高度', async () => {
  giveScrollerHeight(320)
  const wrapper = mount(ChapterTree, { props: { tree: many, selectedId: 'c900' }, attachTo: document.body })
  await flushPromises()
  const ids = rowIds(wrapper)
  expect(ids).toHaveLength(10 + OVERSCAN + 1)
  expect(ids.at(-1)).toBe('c900')
  expect(wrapper.find('.chapter-tree__list').attributes('style')).toContain(`height: ${1000 * 32}px`)
  expect(wrapper.findAll('.chapter-tree__node').at(-1)!.attributes('style')).toContain(`top: ${900 * 32}px`)

  const scroller = wrapper.find('.chapter-tree__scroll').element as HTMLElement
  scroller.scrollTop = 500 * 32
  scroller.dispatchEvent(new Event('scroll'))
  await flushPromises()
  expect(rowIds(wrapper)).toContain('c505')
  expect(rowIds(wrapper)).not.toContain('c0')
  wrapper.unmount()
})

test('↓ 移到窗口外的下一行：该行被渲染并获得焦点', async () => {
  giveScrollerHeight(320)
  const wrapper = mount(ChapterTree, { props: { tree: many, selectedId: 'c0' }, attachTo: document.body })
  await flushPromises()
  const last = `c${10 + OVERSCAN - 1}`
  await wrapper.setProps({ selectedId: last })
  await wrapper.find(`[data-chapter-id="${last}"]`).trigger('keydown', { key: 'ArrowDown' })
  expect(wrapper.emitted('select')!.at(-1)).toEqual([`c${10 + OVERSCAN}`])
  await flushPromises()
  expect(document.activeElement?.getAttribute('data-chapter-id')).toBe(`c${10 + OVERSCAN}`)
  wrapper.unmount()
})

test(`少于 ${MIN_ROWS} 行或量不到高度时渲染全部行，按正常文档流排列`, async () => {
  giveScrollerHeight(320)
  const few = mount(ChapterTree, { props: { tree: many.slice(0, MIN_ROWS - 1) } })
  await flushPromises()
  expect(rowIds(few)).toHaveLength(MIN_ROWS - 1)
  expect(few.find('.chapter-tree__node').attributes('style')).toBeUndefined()

  giveScrollerHeight(0)
  expect(rowIds(mount(ChapterTree, { props: { tree: many } }))).toHaveLength(1000)
})
