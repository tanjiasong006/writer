import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ChapterManager from './ChapterManager.vue'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'

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
function mountManager(selectedId: ChapterId | null = null, tree: ChapterTree = nested): VueWrapper {
  const wrapper: VueWrapper = mount(ChapterManager, {
    attachTo: document.body,
    props: {
      tree,
      selectedId,
      hasContent: () => false,
      'onUpdate:tree': (next: ChapterTree) => wrapper.setProps({ tree: next }),
      'onUpdate:selectedId': (next: ChapterId | null) => wrapper.setProps({ selectedId: next }),
      'onUpdate:collapsedIds': (next: ReadonlySet<ChapterId>) => wrapper.setProps({ collapsedIds: next }),
    },
  })
  mounted.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function label(wrapper: VueWrapper, id: ChapterId): ReturnType<VueWrapper['find']> {
  return wrapper.find(`.chapter-tree__label[data-chapter-id="${id}"]`)
}

async function press(
  wrapper: VueWrapper,
  id: ChapterId,
  key: string,
  modifiers: { altKey?: boolean; shiftKey?: boolean } = {},
): Promise<void> {
  await label(wrapper, id).trigger('keydown', { key, ...modifiers })
  await flushPromises()
}

function visibleIds(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('.chapter-tree__label')
    .map((element) => element.attributes('data-chapter-id') ?? '')
}

/** 受控挂载下，最新的 props 就是上层持有的状态。 */
function selected(wrapper: VueWrapper): ChapterId | null {
  return (wrapper.props() as { selectedId: ChapterId | null }).selectedId
}

function currentTree(wrapper: VueWrapper): ChapterTree {
  return (wrapper.props() as { tree: ChapterTree }).tree
}

function focusedId(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset.chapterId
}

test('↑ / ↓ 在可见章节间选择，并把焦点移到该行', async () => {
  const wrapper = mountManager('a')

  await press(wrapper, 'a', 'ArrowDown')
  expect(selected(wrapper)).toBe('a1')
  expect(focusedId()).toBe('a1')

  await press(wrapper, 'a1', 'ArrowUp')
  expect(selected(wrapper)).toBe('a')

  // 已在第一行时 ↑ 不变。
  await press(wrapper, 'a', 'ArrowUp')
  expect(selected(wrapper)).toBe('a')
})

test('Home / End 选择第一个与最后一个可见章节', async () => {
  const wrapper = mountManager('a1')
  await press(wrapper, 'a1', 'End')
  expect(selected(wrapper)).toBe('b')
  await press(wrapper, 'b', 'Home')
  expect(selected(wrapper)).toBe('a')
})

test('← 先折叠，再回到父章节；→ 先展开，再进入第一个子章节', async () => {
  const wrapper = mountManager('a2')

  await press(wrapper, 'a2', 'ArrowLeft')
  expect(visibleIds(wrapper)).toEqual(['a', 'a1', 'a2', 'b'])
  expect(selected(wrapper)).toBe('a2')

  await press(wrapper, 'a2', 'ArrowLeft')
  expect(selected(wrapper)).toBe('a')

  await press(wrapper, 'a', 'ArrowDown')
  await press(wrapper, 'a1', 'ArrowDown')
  await press(wrapper, 'a2', 'ArrowRight')
  expect(visibleIds(wrapper)).toContain('a2x')
  expect(selected(wrapper)).toBe('a2')

  await press(wrapper, 'a2', 'ArrowRight')
  expect(selected(wrapper)).toBe('a2x')
})

test('只有一行在 Tab 顺序中：选中行，无选中时是第一行', async () => {
  const tabbable = (wrapper: VueWrapper): string[] =>
    wrapper
      .findAll('.chapter-tree__label[tabindex="0"]')
      .map((element) => element.attributes('data-chapter-id') ?? '')

  expect(tabbable(mountManager(null))).toEqual(['a'])
  expect(tabbable(mountManager('a2'))).toEqual(['a2'])
})

test('Enter 发出 open，且不切换折叠状态', async () => {
  const wrapper = mountManager('a1')
  await press(wrapper, 'a', 'Enter')
  expect(selected(wrapper)).toBe('a')
  expect(wrapper.emitted('open')).toEqual([['a']])
  expect(visibleIds(wrapper)).toContain('a1')
})

test('Delete 不删除章节', async () => {
  const wrapper = mountManager('b')
  await press(wrapper, 'b', 'Delete')
  expect(wrapper.emitted('update:tree')).toBeUndefined()
})

test('Alt+Shift+↑ / ↓ 在同级间移动，焦点留在被移动的章节', async () => {
  const wrapper = mountManager('b')

  await press(wrapper, 'b', 'ArrowUp', { altKey: true, shiftKey: true })
  expect(currentTree(wrapper).map((n) => n.id)).toEqual(['b', 'a'])
  expect(selected(wrapper)).toBe('b')
  expect(focusedId()).toBe('b')

  await press(wrapper, 'b', 'ArrowDown', { altKey: true, shiftKey: true })
  expect(currentTree(wrapper).map((n) => n.id)).toEqual(['a', 'b'])
})

test('Alt+Shift+→ 降级为上一个兄弟的子章节，Alt+Shift+← 提升回来', async () => {
  const wrapper = mountManager('b')

  await press(wrapper, 'b', 'ArrowRight', { altKey: true, shiftKey: true })
  const indented = currentTree(wrapper)
  expect(indented.map((n) => n.id)).toEqual(['a'])
  expect(indented[0].children.map((n) => n.id)).toEqual(['a1', 'a2', 'b'])
  expect(focusedId()).toBe('b')

  await press(wrapper, 'b', 'ArrowLeft', { altKey: true, shiftKey: true })
  expect(currentTree(wrapper).map((n) => n.id)).toEqual(['a', 'b'])
})

test('降级进已折叠的章节时自动展开，焦点仍在被移动的章节', async () => {
  const wrapper = mountManager('b')
  await press(wrapper, 'a', 'ArrowLeft')
  expect(visibleIds(wrapper)).toEqual(['a', 'b'])

  await press(wrapper, 'b', 'ArrowRight', { altKey: true, shiftKey: true })
  expect(visibleIds(wrapper)).toContain('b')
  expect(focusedId()).toBe('b')
})

test('键盘移动到边界时不发出移动', async () => {
  const wrapper = mountManager('a')
  await press(wrapper, 'a', 'ArrowUp', { altKey: true, shiftKey: true })
  await press(wrapper, 'a', 'ArrowLeft', { altKey: true, shiftKey: true })
  await press(wrapper, 'a', 'ArrowRight', { altKey: true, shiftKey: true })
  expect(wrapper.emitted('update:tree')).toBeUndefined()
})

test('键盘降级超过层级上限时显示原因，不改树', async () => {
  // x 自身带 32 级子树，降级后会变成 33 级。
  let chain: ChapterTree = []
  for (let depth = 32; depth >= 2; depth--) {
    chain = [{ id: `d${depth}`, title: `D${depth}`, children: chain }]
  }
  const wrapper = mountManager('x', [
    { id: 'p', title: 'P', children: [] },
    { id: 'x', title: 'X', children: chain },
  ])
  await press(wrapper, 'x', 'ArrowRight', { altKey: true, shiftKey: true })
  expect(wrapper.emitted('update:tree')).toBeUndefined()
  expect(wrapper.find('.chapter-manager__error').text()).toContain('层级太深')
})

test('菜单中的移动项：边界处不可用，可用时与快捷键效果相同', async () => {
  const wrapper = mountManager('b')
  const menuItem = (label: string) =>
    wrapper.findAll('.chapter-tree__menu button').find((b) => b.text().startsWith(label))!

  await wrapper.find('.chapter-tree__row:has([data-chapter-id="b"]) .chapter-tree__more').trigger('click')
  expect(menuItem('下移').attributes('disabled')).toBeDefined()
  expect(menuItem('升级').attributes('disabled')).toBeDefined()
  expect(menuItem('上移').attributes('disabled')).toBeUndefined()

  await menuItem('降级').trigger('click')
  await flushPromises()
  expect(currentTree(wrapper)[0].children.map((n) => n.id)).toEqual(['a1', 'a2', 'b'])
  expect(wrapper.find('.chapter-tree__menu').exists()).toBe(false)
  expect(focusedId()).toBe('b')
})
