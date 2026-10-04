import { expect, test } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ChapterTree from './ChapterTree.vue'
import type { ChapterTree as ChapterTreeModel } from '../../domain/chapter_tree/chapter_tree.ts'

const outline: ChapterTreeModel = [
  { id: 'a', title: 'A', children: [{ id: 'b', title: 'B', children: [] }] },
  { id: 'c', title: 'C', children: [] },
]

function mountTree(
  tree: ChapterTreeModel = outline,
  editingId: string | null = null,
): ReturnType<typeof mount> {
  return mount(ChapterTree, { props: { tree, selectedId: null, editingId } })
}

async function openMenu(wrapper: ReturnType<typeof mount>, rowIndex: number): Promise<void> {
  await wrapper.findAll('.chapter-tree__row')[rowIndex].find('.chapter-tree__more').trigger('click')
}

async function clickMenu(wrapper: ReturnType<typeof mount>, label: string): Promise<void> {
  const item = wrapper.findAll('.chapter-tree__menu button').find((b) => b.text().startsWith(label))
  if (!item) throw new Error(`菜单项不存在：${label}`)
  await item.trigger('click')
}

test('Tree Header 的 + 发出 create-root', async () => {
  const wrapper = mountTree()
  await wrapper.find('.chapter-tree__add').trigger('click')
  expect(wrapper.emitted('create-root')).toHaveLength(1)
})

test('空状态按钮发出 create-root', async () => {
  const wrapper = mountTree([])
  expect(wrapper.find('.chapter-tree__empty').text()).toContain('暂无章节')
  await wrapper.find('.chapter-tree__empty-action').trigger('click')
  expect(wrapper.emitted('create-root')).toHaveLength(1)
})

test('节点菜单包含新建、移动、重命名、删除，点击后关闭', async () => {
  const wrapper = mountTree()
  await openMenu(wrapper, 0)

  const labels = wrapper
    .findAll('.chapter-tree__menu button')
    .map((b) => b.find('.popup-menu__label').text())
  expect(labels).toEqual(['新建同级章节', '新建子章节', '上移', '下移', '升级', '降级', '无', '草稿', '待修改', '完成', '添加备注…', '重命名', '删除'])

  await clickMenu(wrapper, '新建同级章节')
  expect(wrapper.find('.chapter-tree__menu').exists()).toBe(false)
})

test('菜单项分别发出对应意图', async () => {
  const wrapper = mountTree()

  await openMenu(wrapper, 0)
  await clickMenu(wrapper, '新建同级章节')
  await openMenu(wrapper, 1)
  await clickMenu(wrapper, '新建子章节')
  await openMenu(wrapper, 0)
  await clickMenu(wrapper, '重命名')
  await openMenu(wrapper, 2)
  await clickMenu(wrapper, '删除')

  expect(wrapper.emitted('create-sibling')).toEqual([['a']])
  expect(wrapper.emitted('create-child')).toEqual([['b']])
  expect(wrapper.emitted('start-rename')).toEqual([['a']])
  expect(wrapper.emitted('delete')).toEqual([['c']])
})

test('点击遮罩关闭菜单', async () => {
  const wrapper = mountTree()
  await openMenu(wrapper, 0)
  expect(wrapper.find('.chapter-tree__menu').exists()).toBe(true)

  await wrapper.find('.chapter-tree__backdrop').trigger('click')
  expect(wrapper.find('.chapter-tree__menu').exists()).toBe(false)
})

test('打开菜单不触发选择', async () => {
  const wrapper = mountTree()
  await openMenu(wrapper, 0)
  expect(wrapper.emitted('select')).toBeUndefined()
})

test('editingId 渲染预填标题的输入框', () => {
  const wrapper = mountTree(outline, 'b')
  const input = wrapper.find<HTMLInputElement>('.chapter-tree__rename-input')
  expect(input.exists()).toBe(true)
  expect(input.element.value).toBe('B')
})

test('内联编辑 Enter 发出 rename', async () => {
  const wrapper = mountTree(outline, 'b')
  const input = wrapper.find('.chapter-tree__rename-input')
  await input.setValue('  B 改  ')
  await input.trigger('keydown.enter')
  expect(wrapper.emitted('rename')).toEqual([['b', 'B 改']])
})

test('内联编辑空标题 Enter 视为取消', async () => {
  const wrapper = mountTree(outline, 'b')
  const input = wrapper.find('.chapter-tree__rename-input')
  await input.setValue('   ')
  await input.trigger('keydown.enter')
  expect(wrapper.emitted('rename')).toBeUndefined()
  expect(wrapper.emitted('cancel-rename')).toHaveLength(1)
})

test('内联编辑 Esc 发出 cancel-rename', async () => {
  const wrapper = mountTree(outline, 'b')
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown.esc')
  expect(wrapper.emitted('cancel-rename')).toHaveLength(1)
})

test('内联编辑失焦发出 rename', async () => {
  const wrapper = mountTree(outline, 'b')
  const input = wrapper.find('.chapter-tree__rename-input')
  await input.setValue('B2')
  await input.trigger('blur')
  expect(wrapper.emitted('rename')).toEqual([['b', 'B2']])
})

test('重命名已有章节：Enter / Esc 结束后焦点回到该章节所在行，不掉到页面上', async () => {
  for (const key of ['enter', 'esc']) {
    // 像真实上层一样：收到 rename / cancel-rename 时结束编辑，输入框消失、标题按钮重新出现。
    const wrapper: ReturnType<typeof mount> = mount(ChapterTree, {
      props: {
        tree: outline,
        selectedId: 'c',
        editingId: 'c',
        onRename: () => wrapper.setProps({ editingId: null }),
        'onCancel-rename': () => wrapper.setProps({ editingId: null }),
      },
      attachTo: document.body,
    })
    await wrapper.find('.chapter-tree__rename-input').trigger(`keydown.${key}`)
    await nextTick()
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(document.activeElement).toBe(wrapper.find('.chapter-tree__label[data-chapter-id="c"]').element)
    wrapper.unmount()
  }
})

test('双击标题不进入编辑，也不发出 start-rename', async () => {
  const wrapper = mountTree()
  await wrapper.findAll('.chapter-tree__row')[1].trigger('dblclick')
  expect(wrapper.emitted('start-rename')).toBeUndefined()
})

test('重命名没有快捷键：F2 不发出 start-rename', async () => {
  const wrapper = mountTree()
  const label = wrapper.findAll('.chapter-tree__row')[1].find('.chapter-tree__label')
  await label.trigger('keydown', { key: 'F2' })
  expect(wrapper.emitted('start-rename')).toBeUndefined()
})

test('右键打开节点菜单，不改变选中章节，只标出菜单作用的行', async () => {
  const wrapper = mountTree()
  const row = wrapper.findAll('.chapter-tree__row')[1]
  await row.trigger('contextmenu', { clientX: 40, clientY: 50 })
  expect(wrapper.find('.chapter-tree__menu').exists()).toBe(true)
  expect(row.classes()).toContain('chapter-tree__row--menu-target')
  expect(wrapper.emitted('select')).toBeUndefined()
})

test('Shift+F10 打开节点菜单，第一项获得焦点；↓ 移到下一项；Esc 关闭', async () => {
  const wrapper = mount(ChapterTree, { props: { tree: outline, selectedId: null }, attachTo: document.body })
  await wrapper.findAll('.chapter-tree__label')[0].trigger('keydown', { key: 'F10', shiftKey: true })
  await flushPromises()
  const items = wrapper.findAll('.chapter-tree__menu button')
  expect(document.activeElement).toBe(items[0].element)
  await wrapper.find('.chapter-tree__menu').trigger('keydown', { key: 'ArrowDown' })
  expect(document.activeElement).toBe(items[1].element)
  await wrapper.find('.chapter-tree__menu').trigger('keydown', { key: 'Escape' })
  expect(wrapper.find('.chapter-tree__menu').exists()).toBe(false)
  wrapper.unmount()
})
