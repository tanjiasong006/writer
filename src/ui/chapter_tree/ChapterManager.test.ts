import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
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

/** 受控挂载：像真实上层一样把 update:* 回写为新的 props。 */
function mountManager(
  initialTree: ChapterTree = nested,
  initialSelectedId: string | null = null,
  hasContent?: (id: string) => boolean,
): VueWrapper {
  const wrapper: VueWrapper = mount(ChapterManager, {
    attachTo: document.body,
    props: {
      tree: initialTree,
      selectedId: initialSelectedId,
      hasContent,
      'onUpdate:tree': (tree: ChapterTree) => wrapper.setProps({ tree }),
      'onUpdate:selectedId': (selectedId: string | null) => wrapper.setProps({ selectedId }),
    },
  })
  mounted.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function rowText(row: ReturnType<VueWrapper['find']>): string {
  const number = row.find('.chapter-tree__number').text()
  const input = row.find<HTMLInputElement>('.chapter-tree__rename-input')
  if (input.exists()) return number + input.element.value
  return number + row.find('.chapter-tree__title').text()
}

function rowTexts(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.chapter-tree__row').map((row) => rowText(row))
}

function rows(wrapper: VueWrapper) {
  return wrapper.findAll('.chapter-tree__row')
}

function button(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  if (!found) throw new Error(`找不到按钮：${label}`)
  return found
}

async function openMenu(wrapper: VueWrapper, rowIndex: number): Promise<void> {
  await rows(wrapper)[rowIndex].find('.chapter-tree__more').trigger('click')
}

/** 菜单项旁可能显示快捷键，按菜单项的名称查找。 */
async function menuItem(wrapper: VueWrapper, label: string): Promise<void> {
  const item = wrapper.findAll('.chapter-tree__menu button').find((b) => b.find('.popup-menu__label').text() === label)
  if (!item) throw new Error(`菜单项不存在：${label}`)
  await item.trigger('click')
}

function renameInput(wrapper: VueWrapper) {
  return wrapper.find<HTMLInputElement>('.chapter-tree__rename-input')
}

// --- 渲染与空状态 ---

test('渲染章节树与 Tree Header', () => {
  const wrapper = mountManager()
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])
  expect(wrapper.find('.chapter-tree__header').text()).toContain('章节')
  expect(wrapper.find('.chapter-tree__add').exists()).toBe(true)
})

test('空树显示空状态与新建入口', () => {
  const wrapper = mountManager([])
  expect(rowTexts(wrapper)).toEqual([])
  expect(wrapper.find('.chapter-tree__empty').text()).toContain('暂无章节')
  expect(button(wrapper, '新建第一个章节').exists()).toBeTruthy()
})

// --- 新建 ---

test('Header + 无选中：追加根章节为未命名章节，选中并进入编辑', async () => {
  const wrapper = mountManager()
  await wrapper.find('.chapter-tree__add').trigger('click')

  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B', '3未命名章节'])
  expect(rowText(wrapper.find('.chapter-tree__row--selected'))).toBe('3未命名章节')
  expect(renameInput(wrapper).element.value).toBe('未命名章节')
})

test('新建章节后输入标题按 Enter 直接进入正文；重命名已有章节按 Enter 留在章节树', async () => {
  const wrapper = mountManager()
  await wrapper.find('.chapter-tree__add').trigger('click')
  await renameInput(wrapper).setValue('新的一章')
  await renameInput(wrapper).trigger('keydown.enter')
  expect(rowTexts(wrapper)).toContain('3新的一章')
  expect(wrapper.emitted('open')).toHaveLength(1)

  await rows(wrapper)[0].find('.chapter-tree__label').trigger('keydown', { key: 'F2' })
  await renameInput(wrapper).setValue('A 改')
  await renameInput(wrapper).trigger('keydown.enter')
  expect(rowTexts(wrapper)[0]).toBe('1A 改')
  expect(wrapper.emitted('open')).toHaveLength(1)
})

test('Header + 有选中：在选中章节之后新建同级', async () => {
  const wrapper = mountManager()
  await rows(wrapper)[0].trigger('click') // a
  await wrapper.find('.chapter-tree__add').trigger('click')

  expect(rowTexts(wrapper)).toEqual([
    '1A',
    '1.1A1',
    '1.2A2',
    '1.2.1A2X',
    '2未命名章节',
    '3B',
  ])
})

test('节点菜单：新建同级章节', async () => {
  const wrapper = mountManager()
  await openMenu(wrapper, 0) // a
  await menuItem(wrapper, '新建同级章节')

  expect(rowTexts(wrapper)).toEqual([
    '1A',
    '1.1A1',
    '1.2A2',
    '1.2.1A2X',
    '2未命名章节',
    '3B',
  ])
  expect(wrapper.find('.chapter-tree__menu').exists()).toBe(false)
})

test('节点菜单：新建子章节追加到末尾', async () => {
  const wrapper = mountManager()
  await openMenu(wrapper, 0) // a
  await menuItem(wrapper, '新建子章节')

  expect(rowTexts(wrapper)).toEqual([
    '1A',
    '1.1A1',
    '1.2A2',
    '1.2.1A2X',
    '1.3未命名章节',
    '2B',
  ])
})

test('新建后自动聚焦标题输入框', async () => {
  const wrapper = mountManager()
  await wrapper.find('.chapter-tree__add').trigger('click')
  await nextTick()

  expect(document.activeElement).toBe(renameInput(wrapper).element)
})

// --- 内联重命名 ---

test('Enter 保存新标题', async () => {
  const wrapper = mountManager()
  await wrapper.find('.chapter-tree__add').trigger('click')
  await renameInput(wrapper).setValue('新章')
  await renameInput(wrapper).trigger('keydown.enter')

  expect(rowTexts(wrapper)).toContain('3新章')
  expect(renameInput(wrapper).exists()).toBe(false)
})

test('失焦保存新标题', async () => {
  const wrapper = mountManager()
  await wrapper.find('.chapter-tree__add').trigger('click')
  await renameInput(wrapper).setValue('失焦保存')
  await renameInput(wrapper).trigger('blur')

  expect(rowTexts(wrapper)).toContain('3失焦保存')
})

test('Esc 取消编辑，保留默认标题', async () => {
  const wrapper = mountManager()
  await wrapper.find('.chapter-tree__add').trigger('click')
  await renameInput(wrapper).setValue('不要保存')
  await renameInput(wrapper).trigger('keydown.esc')

  expect(rowTexts(wrapper)).toContain('3未命名章节')
  expect(rowTexts(wrapper)).not.toContain('3不要保存')
  expect(renameInput(wrapper).exists()).toBe(false)
})

test('F2 进入内联重命名并预填当前标题', async () => {
  const wrapper = mountManager()
  await rows(wrapper)[0].find('.chapter-tree__label').trigger('keydown', { key: 'F2' })

  expect(renameInput(wrapper).element.value).toBe('A')
  await renameInput(wrapper).setValue('A 改')
  await renameInput(wrapper).trigger('keydown.enter')
  expect(rowTexts(wrapper)[0]).toBe('1A 改')
})

test('菜单重命名进入内联编辑', async () => {
  const wrapper = mountManager()
  await openMenu(wrapper, 1) // a1
  await menuItem(wrapper, '重命名')
  expect(renameInput(wrapper).element.value).toBe('A1')
})

test('选择其他章节会取消正在进行的重命名', async () => {
  const wrapper = mountManager()
  await rows(wrapper)[0].find('.chapter-tree__label').trigger('keydown', { key: 'F2' })
  expect(renameInput(wrapper).exists()).toBe(true)

  await rows(wrapper)[4].trigger('click') // b
  expect(renameInput(wrapper).exists()).toBe(false)
})

// --- 删除 ---

test('删除：先显示确认，确认前不改树', async () => {
  const wrapper = mountManager()
  await openMenu(wrapper, 0) // a
  await menuItem(wrapper, '删除')

  expect(wrapper.find('.chapter-manager__confirm').exists()).toBe(true)
  expect(wrapper.find('.chapter-manager__confirm').text()).toContain('A')
  expect(wrapper.find('.chapter-manager__confirm').text()).toContain('子章节')
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])
})

test('删除确认：整棵子树被删除，改为选中相邻章节', async () => {
  const wrapper = mountManager()
  await rows(wrapper)[0].trigger('click') // a
  await openMenu(wrapper, 0)
  await menuItem(wrapper, '删除')
  await button(wrapper, '删除').trigger('click')
  await flushPromises()

  expect(rowTexts(wrapper)).toEqual(['1B'])
  expect(wrapper.props('selectedId' as never)).toBe('b')
  expect(rowText(wrapper.find('.chapter-tree__row--selected'))).toBe('1B')
})

test('选中章节在被删除的子树中：改为选中被删章节的相邻章节', async () => {
  const wrapper = mountManager()
  await rows(wrapper)[1].trigger('click') // a1
  await openMenu(wrapper, 0) // a
  await menuItem(wrapper, '删除')
  await button(wrapper, '删除').trigger('click')
  await flushPromises()

  expect(rowTexts(wrapper)).toEqual(['1B'])
  expect(wrapper.props('selectedId' as never)).toBe('b')
})

test('删除唯一的章节后没有选中章节', async () => {
  const wrapper = mountManager([{ id: 'only', title: '唯一', children: [] }], 'only')
  await openMenu(wrapper, 0)
  await menuItem(wrapper, '删除')
  await button(wrapper, '删除').trigger('click')
  await flushPromises()
  expect(wrapper.props('selectedId' as never)).toBeNull()
})

test('删除其他章节不改变当前选中', async () => {
  const wrapper = mountManager(undefined, 'b')
  await openMenu(wrapper, 1) // a1
  await menuItem(wrapper, '删除')
  await flushPromises()
  expect(wrapper.props('selectedId' as never)).toBe('b')
})

test('删除取消：保留章节与选择', async () => {
  const wrapper = mountManager()
  await rows(wrapper)[0].trigger('click')
  await openMenu(wrapper, 0)
  await menuItem(wrapper, '删除')
  await button(wrapper, '取消').trigger('click')

  expect(wrapper.find('.chapter-manager__confirm').exists()).toBe(false)
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X', '2B'])
  expect(rowText(wrapper.find('.chapter-tree__row--selected'))).toBe('1A')
})

test('删除确认打开后焦点进入取消按钮，Esc 取消', async () => {
  const wrapper = mountManager()
  await openMenu(wrapper, 0)
  await menuItem(wrapper, '删除')
  await nextTick()

  const cancelButton = button(wrapper, '取消')
  expect(document.activeElement).toBe(cancelButton.element)

  await cancelButton.trigger('keydown', { key: 'Escape' })
  expect(wrapper.find('.chapter-manager__confirm').exists()).toBe(false)
})

test('删除确认是模态的：Tab 只在两个按钮之间循环；取消后焦点回到该章节', async () => {
  const wrapper = mountManager()
  await openMenu(wrapper, 0)
  await menuItem(wrapper, '删除')
  await nextTick()

  const cancelButton = button(wrapper, '取消')
  const deleteButton = button(wrapper, '删除')
  await cancelButton.trigger('keydown', { key: 'Tab' })
  expect(document.activeElement).toBe(deleteButton.element)
  await deleteButton.trigger('keydown', { key: 'Tab' })
  expect(document.activeElement).toBe(cancelButton.element)
  await cancelButton.trigger('keydown', { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(deleteButton.element)

  await cancelButton.trigger('click')
  await flushPromises()
  expect(document.activeElement).toBe(wrapper.find('.chapter-tree__label[data-chapter-id="a"]').element)
})

test('确认删除后焦点落在删除后选中的章节上', async () => {
  const wrapper = mountManager(nested, 'b')
  await openMenu(wrapper, 4) // b
  await menuItem(wrapper, '删除')
  await nextTick()
  await button(wrapper, '删除').trigger('click')
  await flushPromises()
  const selected = wrapper.find('.chapter-tree__row--selected .chapter-tree__label')
  expect(document.activeElement).toBe(selected.element)
})

// --- 删除确认规则（ui-spec §23）---

test('没有子章节也没有正文：直接删除，不弹确认', async () => {
  const wrapper = mountManager(nested, null, () => false)
  await openMenu(wrapper, 4) // b
  await menuItem(wrapper, '删除')

  expect(wrapper.find('.chapter-manager__confirm').exists()).toBe(false)
  expect(rowTexts(wrapper)).toEqual(['1A', '1.1A1', '1.2A2', '1.2.1A2X'])
})

test('有正文的叶子章节：需要确认，并提示包含正文', async () => {
  const wrapper = mountManager(nested, null, (id) => id === 'b')
  await openMenu(wrapper, 4) // b
  await menuItem(wrapper, '删除')

  const text = wrapper.find('.chapter-manager__confirm').text()
  expect(text).toContain('包含正文')
  expect(text).not.toContain('子章节')
  expect(rowTexts(wrapper)).toHaveLength(5)
})

test('确认文案统计全部后代而不只是直接子章节', async () => {
  const wrapper = mountManager(nested, null, () => false)
  await openMenu(wrapper, 0) // a：a1、a2、a2x 共 3 个后代
  await menuItem(wrapper, '删除')
  expect(wrapper.find('.chapter-manager__confirm').text()).toContain('3 个子章节')
})

test('既有正文又有子章节：文案同时说明两者', async () => {
  const wrapper = mountManager(nested, null, () => true)
  await openMenu(wrapper, 2) // a2：1 个后代
  await menuItem(wrapper, '删除')
  expect(wrapper.find('.chapter-manager__confirm').text()).toContain('包含正文以及 1 个子章节')
})

test('折叠状态通过 update:collapsedIds 通知上层', async () => {
  const wrapper = mountManager()
  await wrapper.findAll('button.chapter-tree__toggle')[0].trigger('click')
  const emitted = wrapper.emitted('update:collapsedIds')
  expect(emitted).toHaveLength(1)
  expect([...(emitted![0][0] as Set<string>)]).toEqual(['a'])
})
