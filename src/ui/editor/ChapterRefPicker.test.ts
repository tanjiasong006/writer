import { afterEach, expect, test } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import ChapterRefPicker from './ChapterRefPicker.vue'

const tree: ChapterTree = [
  { id: 'a', title: '绪论', children: [{ id: 'a1', title: '研究背景', children: [] }, { id: 'a2', title: '', children: [] }] },
  { id: 'b', title: '研究方法', children: [] },
]

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function mountPicker(props: Partial<InstanceType<typeof ChapterRefPicker>['$props']> = {}) {
  const wrapper = mount(ChapterRefPicker, { attachTo: document.body, props: { tree, anchor: { x: 10, y: 10 }, ...props } })
  mounted.push(wrapper)
  return wrapper
}

const options = (wrapper: VueWrapper) => wrapper.findAll('[role="option"]').map((option) => option.text())
const active = (wrapper: VueWrapper) => wrapper.find('.chapter-ref-picker__option--active').text()

test('按章节树顺序列出全部章节，编号在前；搜索框获得焦点', () => {
  const wrapper = mountPicker()
  expect(options(wrapper)).toEqual(['1绪论', '1.1研究背景', '1.2未命名章节', '2研究方法'])
  expect(active(wrapper)).toBe('1绪论')
  expect(document.activeElement).toBe(wrapper.find('input').element)
})

test('按标题或编号筛选，没有结果时说明', async () => {
  const wrapper = mountPicker()
  const input = wrapper.find('input')
  await input.setValue('研究')
  expect(options(wrapper)).toEqual(['1.1研究背景', '2研究方法'])
  await input.setValue('1.')
  expect(options(wrapper)).toEqual(['1.1研究背景', '1.2未命名章节'])
  await input.setValue('结论')
  expect(options(wrapper)).toEqual([])
  expect(wrapper.text()).toContain('没有匹配的章节')
})

test('↑ / ↓ 选择，Enter 确定（带当前显示格式）；Esc 取消', async () => {
  const wrapper = mountPicker()
  const input = wrapper.find('input')
  await input.trigger('keydown', { key: 'ArrowUp' })
  expect(active(wrapper)).toBe('2研究方法')
  await input.trigger('keydown', { key: 'ArrowDown' })
  await input.trigger('keydown', { key: 'ArrowDown' })
  await wrapper.findAll('[role="radio"]')[1]!.trigger('click') // 仅编号
  await input.trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('pick')).toEqual([['a1', 'number']])

  await input.trigger('keydown', { key: 'Escape' })
  expect(wrapper.emitted('cancel')).toHaveLength(1)
})

test('点击章节确定；点击浮层以外取消', async () => {
  const wrapper = mountPicker()
  await wrapper.findAll('[role="radio"]')[2]!.trigger('click') // 仅标题
  await wrapper.findAll('[role="option"]')[3]!.trigger('click')
  expect(wrapper.emitted('pick')).toEqual([['b', 'title']])
  await wrapper.find('.chapter-ref-picker__backdrop').trigger('click')
  expect(wrapper.emitted('cancel')).toHaveLength(1)
})

test('显示格式默认是本次运行中上次的选择', async () => {
  const first = mountPicker()
  await first.findAll('[role="radio"]')[1]!.trigger('click') // 仅编号
  await first.find('input').trigger('keydown', { key: 'Enter' })
  const next = mountPicker()
  expect(next.find('[role="radio"][aria-checked="true"]').text()).toBe('仅编号')
})

test('更改已有引用：预先选中它的目标与格式', () => {
  const wrapper = mountPicker({ current: { id: 'b', show: 'title' } })
  expect(active(wrapper)).toBe('2研究方法')
  expect(wrapper.find('[role="radio"][aria-checked="true"]').text()).toBe('仅标题')
})
