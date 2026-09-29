import { expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import ChapterTree from './ChapterTree.vue'
import type { ChapterId, ChapterTree as ChapterTreeModel } from '../../domain/chapter_tree/chapter_tree.ts'

const outline: ChapterTreeModel = [
  {
    id: 'a',
    title: 'A',
    children: [
      { id: 'b', title: 'B', children: [{ id: 'c', title: 'C', children: [] }] },
      { id: 'd', title: 'D', children: [] },
    ],
  },
  { id: 'e', title: 'E', children: [] },
]

function mountTree(
  tree: ChapterTreeModel,
  selectedId: ChapterId | null = null,
): ReturnType<typeof mount> {
  return mount(ChapterTree, { props: { tree, selectedId } })
}

function texts(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.chapter-tree__row').map((row) => row.text())
}

test('按树结构渲染所有章节，并显示编号', () => {
  expect(texts(mountTree(outline))).toEqual(['1A', '1.1B', '1.1.1C', '1.2D', '2E'])
})

test('用 depth 表达层级，子章节比父章节深一级', () => {
  const depths = mountTree(outline)
    .findAll('.chapter-tree__row')
    .map((row) => row.attributes('data-depth'))
  expect(depths).toEqual(['0', '1', '2', '1', '0'])
})

test('点击章节行触发 select，并携带该章节 id', async () => {
  const wrapper = mountTree(outline)

  await wrapper.findAll('.chapter-tree__row')[2].trigger('click')
  await wrapper.findAll('.chapter-tree__row')[4].trigger('click')

  expect(wrapper.emitted('select')).toEqual([['c'], ['e']])
})

test('点击有子章节的标题只选中，不展开/收起', async () => {
  const wrapper = mountTree(outline)
  const labelA = wrapper.findAll('.chapter-tree__label')[0]

  await labelA.trigger('click')
  await labelA.trigger('click')

  expect(texts(wrapper)).toEqual(['1A', '1.1B', '1.1.1C', '1.2D', '2E'])
  expect(wrapper.emitted('select')).toEqual([['a'], ['a']])
})

test('点击叶子章节标题不改变显示，仍然触发 select', async () => {
  const wrapper = mountTree(outline)

  await wrapper.findAll('.chapter-tree__label')[4].trigger('click')

  expect(texts(wrapper)).toEqual(['1A', '1.1B', '1.1.1C', '1.2D', '2E'])
  expect(wrapper.emitted('select')).toEqual([['e']])
})

test('selectedId 标记选中行，其他行不受影响', () => {
  const wrapper = mountTree(outline, 'd')

  const selected = wrapper.findAll('.chapter-tree__row--selected')
  expect(selected.map((row) => row.text())).toEqual(['1.2D'])
  expect(selected[0].attributes('aria-current')).toBe('true')

  const first = wrapper.findAll('.chapter-tree__row')[0]
  expect(first.attributes('aria-current')).toBeUndefined()
})

test('空树不渲染任何章节行', () => {
  expect(mountTree([]).findAll('.chapter-tree__row')).toHaveLength(0)
})

test('渲染不修改传入的章节树', async () => {
  const snapshot = JSON.stringify(outline)
  const wrapper = mountTree(outline, 'a')
  await wrapper.findAll('.chapter-tree__row')[0].trigger('click')
  expect(JSON.stringify(outline)).toBe(snapshot)
})

test('有子章节的章节可以折叠，折叠后隐藏所有后代章节', async () => {
  const wrapper = mountTree(outline)
  const toggles = wrapper.findAll('button.chapter-tree__toggle')
  expect(toggles).toHaveLength(2) // a 与 b

  await toggles[0].trigger('click')

  expect(texts(wrapper)).toEqual(['1A', '2E'])
  expect(toggles[0].attributes('aria-expanded')).toBe('false')
})

test('再次展开后恢复显示后代章节', async () => {
  const wrapper = mountTree(outline)
  const toggleA = wrapper.findAll('button.chapter-tree__toggle')[0]

  await toggleA.trigger('click')
  await toggleA.trigger('click')

  expect(texts(wrapper)).toEqual(['1A', '1.1B', '1.1.1C', '1.2D', '2E'])
  expect(toggleA.attributes('aria-expanded')).toBe('true')
})

test('折叠中间章节只隐藏其子树，不影响兄弟章节', async () => {
  const wrapper = mountTree(outline)
  const toggleB = wrapper.findAll('button.chapter-tree__toggle')[1]

  await toggleB.trigger('click')

  expect(texts(wrapper)).toEqual(['1A', '1.1B', '1.2D', '2E'])
})

test('叶子章节不提供折叠按钮，只显示无箭头的占位符', () => {
  const wrapper = mountTree(outline)
  const rows = wrapper.findAll('.chapter-tree__row')

  const togglesByRow = rows.map((row) => row.find('button.chapter-tree__toggle').exists())
  // 行顺序：a, b, c, d, e，其中 a、b 有子章节。
  expect(togglesByRow).toEqual([true, true, false, false, false])

  // 占位符不带 toggle 类，因此不会渲染 ::before 箭头。
  const spacers = rows.map((row) => row.find('.chapter-tree__leaf-spacer').exists())
  expect(spacers).toEqual([false, false, true, true, true])
  expect(wrapper.find('.chapter-tree__toggle--leaf').exists()).toBe(false)
})

test('折叠不影响选中状态', async () => {
  const wrapper = mountTree(outline, 'c')

  await wrapper.findAll('button.chapter-tree__toggle')[1].trigger('click')
  // c 被隐藏，选中态由 selectedId 决定，展开后仍然是它。
  await wrapper.findAll('button.chapter-tree__toggle')[1].trigger('click')

  const selected = wrapper.findAll('.chapter-tree__row--selected')
  expect(selected.map((row) => row.text())).toEqual(['1.1.1C'])
})

test('selectedId 变化时自动展开祖先，让选中章节可见', async () => {
  const wrapper = mountTree(outline)

  // 折叠 a 后，b 与 c 都被隐藏。
  await wrapper.findAll('button.chapter-tree__toggle')[0].trigger('click')
  expect(texts(wrapper)).toEqual(['1A', '2E'])

  await wrapper.setProps({ selectedId: 'c' })

  expect(texts(wrapper)).toEqual(['1A', '1.1B', '1.1.1C', '1.2D', '2E'])
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1.1.1C')
})
