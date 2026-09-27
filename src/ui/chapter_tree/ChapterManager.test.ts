import { afterEach, expect, test } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ChapterManager from './ChapterManager.vue'
import type { ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'

const nested: ChapterTree = [
  {
    id: 'a',
    title: 'A',
    children: [
      { id: 'a1', title: 'A1', children: [] },
      { id: 'a2', title: 'A2', children: [{ id: 'a2x', title: 'A2X', children: [] }] },
    ],
  },
  { id: 'b', title: 'B', children: [] },
]

const mounted: VueWrapper[] = []

function mountManager(
  initialTree: ChapterTree = nested,
  initialSelectedId: string | null = null,
): VueWrapper {
  const wrapper = mount(ChapterManager, {
    attachTo: document.body,
    props: { initialTree, initialSelectedId },
  })
  mounted.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function button(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  if (!found) throw new Error(`找不到按钮：${label}`)
  return found
}

function rowTexts(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.chapter-tree__row').map((row) => row.text())
}

test('渲染章节操作工具栏与章节树', () => {
  const wrapper = mountManager()
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])
  expect(button(wrapper, '新建根章节').attributes('disabled')).toBeUndefined()
  expect(button(wrapper, '新建子章节').attributes('disabled')).toBeDefined()
})

test('空树：只显示工具栏，依赖选择的按钮禁用', () => {
  const wrapper = mountManager([])
  expect(rowTexts(wrapper)).toEqual([])
  expect(button(wrapper, '新建根章节').attributes('disabled')).toBeUndefined()
  expect(button(wrapper, '新建子章节').attributes('disabled')).toBeDefined()
  expect(button(wrapper, '重命名').attributes('disabled')).toBeDefined()
  expect(button(wrapper, '删除').attributes('disabled')).toBeDefined()
})

test('选择章节后启用子章节/重命名/删除', async () => {
  const wrapper = mountManager()
  await wrapper.findAll('.chapter-tree__row')[0].trigger('click')

  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1A')
  expect(button(wrapper, '新建子章节').attributes('disabled')).toBeUndefined()
  expect(button(wrapper, '重命名').attributes('disabled')).toBeUndefined()
  expect(button(wrapper, '删除').attributes('disabled')).toBeUndefined()
})

test('新增根章节：追加到末尾并选中新章节', async () => {
  const wrapper = mountManager()

  await button(wrapper, '新建根章节').trigger('click')
  await wrapper.find('#chapter-manager-title').setValue('新根')
  await wrapper.find('form').trigger('submit')

  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B', '3新根'])
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('3新根')
  expect(wrapper.find('form').exists()).toBe(false)
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})

test('新增子章节：追加到选中章节下并选中新章节', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[0].trigger('click') // a
  await button(wrapper, '新建子章节').trigger('click')
  await wrapper.find('#chapter-manager-title').setValue('新子')
  await wrapper.find('form').trigger('submit')

  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '1.3新子', '2B'])
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1.3新子')
})

test('新增表单：标题为空或全空白时确定禁用，有内容后启用', async () => {
  const wrapper = mountManager()
  await button(wrapper, '新建根章节').trigger('click')

  expect(button(wrapper, '确定').attributes('disabled')).toBeDefined()
  await wrapper.find('#chapter-manager-title').setValue('   ')
  expect(button(wrapper, '确定').attributes('disabled')).toBeDefined()
  await wrapper.find('#chapter-manager-title').setValue('有内容')
  expect(button(wrapper, '确定').attributes('disabled')).toBeUndefined()
})

test('重命名：预填当前标题并只改标题', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[2].trigger('click') // a2
  await button(wrapper, '重命名').trigger('click')
  const input = wrapper.find<HTMLInputElement>('#chapter-manager-title')
  expect(input.element.value).toBe('A2')

  await input.setValue('新 A2')
  await wrapper.find('form').trigger('submit')

  expect(rowTexts(wrapper)).toContain('1.2新 A2')
  expect(rowTexts(wrapper)).not.toContain('1.2A2')
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1.2新 A2')
})

test('重命名取消：关闭表单且不改树', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[2].trigger('click')
  await button(wrapper, '重命名').trigger('click')
  await wrapper.find('#chapter-manager-title').setValue('X')
  await button(wrapper, '取消').trigger('click')

  expect(wrapper.find('form').exists()).toBe(false)
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])
})

test('删除：先显示确认，确认前不改树', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[0].trigger('click') // a
  await button(wrapper, '删除').trigger('click')

  expect(wrapper.find('.chapter-manager__confirm').exists()).toBe(true)
  expect(wrapper.find('.chapter-manager__confirm').text()).toContain('子章节')
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])
})

test('删除取消：保留章节与选择', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[0].trigger('click')
  await button(wrapper, '删除').trigger('click')
  await button(wrapper, '取消').trigger('click')

  expect(wrapper.find('.chapter-manager__confirm').exists()).toBe(false)
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1A')
})

test('删除确认：整棵子树被删除，选择清空', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[0].trigger('click') // a
  await button(wrapper, '删除').trigger('click')
  await button(wrapper, '确认删除').trigger('click')

  expect(rowTexts(wrapper)).toEqual(['1B'])
  expect(wrapper.find('.chapter-tree__row--selected').exists()).toBe(false)
  expect(button(wrapper, '新建子章节').attributes('disabled')).toBeDefined()
})

test('失败：选中的章节不存在时给出中文提示且树不变', async () => {
  const wrapper = mountManager(nested, 'missing')

  await button(wrapper, '删除').trigger('click')
  await button(wrapper, '确认删除').trigger('click')

  expect(wrapper.find('[role="alert"]').text()).toContain('不存在')
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])
})

test('成功操作清除已有错误', async () => {
  const wrapper = mountManager(nested, 'missing')

  await button(wrapper, '删除').trigger('click')
  await button(wrapper, '确认删除').trigger('click')
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)

  await button(wrapper, '新建根章节').trigger('click')
  await wrapper.find('#chapter-manager-title').setValue('新根')
  await wrapper.find('form').trigger('submit')

  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(rowTexts(wrapper)).toContain('3新根')
})

// --- 操作目标稳定：选择变化时放弃未完成的操作 ---

test('选择其他章节会取消未完成的新增子章节', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[0].trigger('click') // a
  await button(wrapper, '新建子章节').trigger('click')
  await wrapper.find('#chapter-manager-title').setValue('误用')

  await wrapper.findAll('.chapter-tree__row')[4].trigger('click') // b

  expect(wrapper.find('form').exists()).toBe(false)
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])
})

test('选择其他章节会取消重命名，重新打开时针对新章节', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[0].trigger('click') // a
  await button(wrapper, '重命名').trigger('click')
  await wrapper.find('#chapter-manager-title').setValue('改了')

  await wrapper.findAll('.chapter-tree__row')[4].trigger('click') // b
  expect(wrapper.find('form').exists()).toBe(false)
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])

  await button(wrapper, '重命名').trigger('click')
  expect(wrapper.find<HTMLInputElement>('#chapter-manager-title').element.value).toBe('B')
})

test('选择其他章节会取消删除确认，重新打开时针对新章节', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[0].trigger('click') // a
  await button(wrapper, '删除').trigger('click')

  await wrapper.findAll('.chapter-tree__row')[4].trigger('click') // b
  expect(wrapper.find('.chapter-manager__confirm').exists()).toBe(false)
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])

  await button(wrapper, '删除').trigger('click')
  expect(wrapper.find('.chapter-manager__confirm').text()).toContain('B')
})

test('重复点击当前已选中的章节不取消未完成的重命名', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[0].trigger('click') // a
  await button(wrapper, '重命名').trigger('click')
  await wrapper.find('#chapter-manager-title').setValue('保留')

  // 再次点击同一个已选中章节，不算切换上下文。
  await wrapper.findAll('.chapter-tree__row')[0].trigger('click')

  expect(wrapper.find('form').exists()).toBe(true)
  expect(wrapper.find<HTMLInputElement>('#chapter-manager-title').element.value).toBe('保留')
})

// --- 键盘焦点 ---

test('删除确认打开后焦点进入确认区，Esc 取消并恢复焦点', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[0].trigger('click') // a
  const deleteButton = button(wrapper, '删除')
  await deleteButton.trigger('click')
  await nextTick()

  const cancelButton = button(wrapper, '取消')
  expect(document.activeElement).toBe(cancelButton.element)

  await cancelButton.trigger('keydown', { key: 'Escape' })
  await nextTick()
  await nextTick()

  expect(wrapper.find('.chapter-manager__confirm').exists()).toBe(false)
  expect(document.activeElement).toBe(deleteButton.element)
})

// --- 折叠状态下新增 ---

test('在折叠的父章节下新增子章节：自动展开父节点并显示新章节', async () => {
  const wrapper = mountManager()

  await wrapper.findAll('.chapter-tree__row')[0].trigger('click') // a
  await wrapper.findAll('button.chapter-tree__toggle')[0].trigger('click') // 折叠 a
  expect(rowTexts(wrapper)).toEqual(['1A', '2B'])

  await button(wrapper, '新建子章节').trigger('click')
  await wrapper.find('#chapter-manager-title').setValue('新子')
  await wrapper.find('form').trigger('submit')

  expect(rowTexts(wrapper)).toContain('1.3新子')
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1.3新子')
  expect(wrapper.findAll('button.chapter-tree__toggle')[0].attributes('aria-expanded')).toBe('true')
})
