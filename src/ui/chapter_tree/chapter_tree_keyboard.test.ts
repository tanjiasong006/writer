import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ChapterManager from './ChapterManager.vue'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { IS_MAC } from '../common/shortcuts.ts'

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
  modifiers: { altKey?: boolean; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {},
): Promise<void> {
  await label(wrapper, id).trigger('keydown', { key, ...modifiers })
  await flushPromises()
}

/**
 * 上移 / 下移 / 升级 / 降级没有快捷键：用键盘打开章节菜单（Shift+F10）选择。
 * 没有系统菜单时菜单由界面绘制；不可用的项不响应。
 */
async function moveByMenu(wrapper: VueWrapper, id: ChapterId, item: string): Promise<void> {
  await press(wrapper, id, 'F10', { shiftKey: true })
  const button = wrapper
    .findAll('[role="menu"] button')
    .find((candidate) => candidate.find('.popup-menu__label').text() === item)
  if (!button) throw new Error(`菜单中没有 ${item}`)
  if (button.attributes('disabled') !== undefined) {
    await wrapper.find('[role="menu"]').trigger('keydown', { key: 'Escape' })
  } else {
    await button.trigger('click')
  }
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

test('章节菜单（Shift+F10）上移 / 下移：在同级间移动，焦点留在被移动的章节', async () => {
  const wrapper = mountManager('b')

  await moveByMenu(wrapper, 'b', '上移')
  expect(currentTree(wrapper).map((n) => n.id)).toEqual(['b', 'a'])
  expect(selected(wrapper)).toBe('b')
  expect(focusedId()).toBe('b')

  await moveByMenu(wrapper, 'b', '下移')
  expect(currentTree(wrapper).map((n) => n.id)).toEqual(['a', 'b'])
})

test('菜单栏的"显示操作菜单"（⌘/）打开焦点章节的菜单，与 Shift+F10 相同', async () => {
  const wrapper = mountManager('b')
  await label(wrapper, 'b').trigger('focus')
  ;(wrapper.vm as unknown as { openChapterMenu(): void }).openChapterMenu()
  await flushPromises()
  expect(wrapper.find('[role="menu"]').exists()).toBe(true)
  expect(document.activeElement).toBe(wrapper.find('[role="menu"] button').element)
  const up = wrapper.findAll('[role="menu"] button').find((button) => button.find('.popup-menu__label').text() === '上移')
  await up!.trigger('click')
  await flushPromises()
  expect(currentTree(wrapper).map((n) => n.id)).toEqual(['b', 'a'])
})

test('章节菜单降级为上一个兄弟的子章节，升级回来', async () => {
  const wrapper = mountManager('b')

  await moveByMenu(wrapper, 'b', '降级')
  const indented = currentTree(wrapper)
  expect(indented.map((n) => n.id)).toEqual(['a'])
  expect(indented[0].children.map((n) => n.id)).toEqual(['a1', 'a2', 'b'])
  expect(focusedId()).toBe('b')

  await moveByMenu(wrapper, 'b', '升级')
  expect(currentTree(wrapper).map((n) => n.id)).toEqual(['a', 'b'])
})

test('降级进已折叠的章节时自动展开，焦点仍在被移动的章节', async () => {
  const wrapper = mountManager('b')
  await press(wrapper, 'a', 'ArrowLeft')
  expect(visibleIds(wrapper)).toEqual(['a', 'b'])

  await moveByMenu(wrapper, 'b', '降级')
  expect(visibleIds(wrapper)).toContain('b')
  expect(focusedId()).toBe('b')
})

test('移动到边界时菜单项不可用，不发出移动', async () => {
  const wrapper = mountManager('a')
  await moveByMenu(wrapper, 'a', '上移')
  await moveByMenu(wrapper, 'a', '升级')
  await moveByMenu(wrapper, 'a', '降级')
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
  await moveByMenu(wrapper, 'x', '降级')
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

const MOD = IS_MAC ? { metaKey: true } : { ctrlKey: true }

test('⌘⌫（Windows：Ctrl+Delete）删除：空章节直接删除，焦点落在相邻章节；单独的 Delete / Backspace 不删除', async () => {
  const wrapper = mountManager('b')
  await press(wrapper, 'b', 'Delete')
  await press(wrapper, 'b', 'Backspace')
  expect(visibleIds(wrapper)).toContain('b')

  await press(wrapper, 'b', IS_MAC ? 'Backspace' : 'Delete', MOD)
  await flushPromises()
  expect(wrapper.find('.chapter-manager__confirm').exists()).toBe(false)
  expect(visibleIds(wrapper)).not.toContain('b')
  expect(focusedId()).toBe(selected(wrapper))
})

test('⌘⌫ 删除有子章节的章节：先确认，焦点在取消按钮', async () => {
  const wrapper = mountManager('a')
  await press(wrapper, 'a', IS_MAC ? 'Backspace' : 'Delete', MOD)
  expect(wrapper.find('.chapter-manager__confirm').text()).toContain('子章节')
  expect(visibleIds(wrapper)).toContain('a')
  expect(document.activeElement?.textContent?.trim()).toBe('取消')
})

test('⌥⇧ 加方向键不移动章节（修饰键必须恰好是 ⌘）', async () => {
  const wrapper = mountManager('b')
  await press(wrapper, 'b', 'ArrowUp', { altKey: true, shiftKey: true })
  expect(wrapper.emitted('update:tree')).toBeUndefined()
})

test('⌘↑ / ⌘↓ 上移 / 下移，⌘→ / ⌘← 降级 / 升级：焦点留在被移动的章节', async () => {
  const wrapper = mountManager('b')
  await press(wrapper, 'b', 'ArrowUp', MOD)
  expect(currentTree(wrapper).map((node) => node.id)).toEqual(['b', 'a'])
  expect(focusedId()).toBe('b')

  await press(wrapper, 'b', 'ArrowDown', MOD)
  expect(currentTree(wrapper).map((node) => node.id)).toEqual(['a', 'b'])

  await press(wrapper, 'b', 'ArrowRight', MOD)
  expect(currentTree(wrapper)[0].children.map((node) => node.id)).toEqual(['a1', 'a2', 'b'])
  expect(focusedId()).toBe('b')

  await press(wrapper, 'b', 'ArrowLeft', MOD)
  expect(currentTree(wrapper).map((node) => node.id)).toEqual(['a', 'b'])
  expect(selected(wrapper)).toBe('b')
})

test('⌘N 在焦点章节之后新建同级章节并进入标题编辑；Enter 确认后焦点留在新章节', async () => {
  const wrapper = mountManager('a1')
  await press(wrapper, 'a1', 'n', MOD)
  const siblings = currentTree(wrapper)[0].children
  expect(siblings).toHaveLength(3)
  const created = siblings[1]
  expect(selected(wrapper)).toBe(created.id)
  const input = wrapper.find<HTMLInputElement>('.chapter-tree__rename-input')
  expect(document.activeElement).toBe(input.element)
  await input.setValue('方法')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(currentTree(wrapper)[0].children[1].title).toBe('方法')
  expect(wrapper.emitted('open')).toBeUndefined()
  expect(focusedId()).toBe(created.id)
})

test('⌘↩ 重命名焦点章节（单独的 Enter 仍是进入正文）；Esc 放弃后焦点回到该行', async () => {
  const wrapper = mountManager('b')
  await press(wrapper, 'b', 'Enter', MOD)
  expect(wrapper.emitted('open')).toBeUndefined()
  const input = wrapper.find<HTMLInputElement>('.chapter-tree__rename-input')
  expect(input.element.value).toBe('B')
  await input.trigger('keydown', { key: 'Escape' })
  await flushPromises()
  expect(wrapper.find('.chapter-tree__rename-input').exists()).toBe(false)
  expect(focusedId()).toBe('b')
})

test('双击章节标题进入重命名；有子章节时展开状态不因点击改变', async () => {
  const wrapper = mountManager('a')
  const title = label(wrapper, 'a')
  await title.trigger('click', { detail: 1 })
  await title.trigger('click', { detail: 2 })
  await title.trigger('dblclick')
  await flushPromises()
  // 正在重命名的 A 显示为输入框；它的子章节仍然展开。
  expect(visibleIds(wrapper)).toEqual(['a1', 'a2', 'a2x', 'b'])
  expect(wrapper.find<HTMLInputElement>('.chapter-tree__rename-input').element.value).toBe('A')
})

test('h / j / k / l 等同 ← / ↓ / ↑ / →；带修饰键时不移动', async () => {
  const wrapper = mountManager('a')
  await press(wrapper, 'a', 'j')
  expect(selected(wrapper)).toBe('a1')
  await press(wrapper, 'a1', 'k')
  expect(selected(wrapper)).toBe('a')
  await press(wrapper, 'a', 'h')
  expect(visibleIds(wrapper)).toEqual(['a', 'b'])
  await press(wrapper, 'a', 'l')
  expect(visibleIds(wrapper)).toContain('a1')
  await press(wrapper, 'a', 'l')
  expect(selected(wrapper)).toBe('a1')
  expect(focusedId()).toBe('a1')
  await press(wrapper, 'a1', 'h')
  expect(selected(wrapper)).toBe('a')

  await press(wrapper, 'a', 'j', { shiftKey: true })
  expect(selected(wrapper)).toBe('a')
})

test('点击行内空白、箭头或树下方空白也让章节树获得焦点，而不只是点标题', async () => {
  const wrapper = mountManager('a')
  const row = (id: ChapterId) => (label(wrapper, id).element as HTMLElement).closest('.chapter-tree__row') as HTMLElement

  // 行内空白：选中并聚焦该行。
  row('b').click()
  await flushPromises()
  expect(selected(wrapper)).toBe('b')
  expect(focusedId()).toBe('b')

  // 箭头：只折叠，不改变当前章节；焦点落在该行。
  ;(document.activeElement as HTMLElement).blur()
  ;(row('a').querySelector('.chapter-tree__toggle') as HTMLElement).click()
  await flushPromises()
  expect(selected(wrapper)).toBe('b')
  expect(focusedId()).toBe('a')

  // 树下方空白：焦点落在可 Tab 聚焦的行。
  ;(document.activeElement as HTMLElement).blur()
  ;(wrapper.find('.chapter-tree__tail').element as HTMLElement).click()
  await flushPromises()
  expect(focusedId()).toBe('a')
  expect(selected(wrapper)).toBe('b')
})
