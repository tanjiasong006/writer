import { vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { Selection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import App from '../App.vue'
import { APP_SERVICES } from '../ui/services.ts'
import { createMemoryServices } from './memory_services.ts'
import { createDocument } from '../domain/document/document.ts'
import type { ChapterTree } from '../domain/chapter_tree/chapter_tree.ts'
import ChapterEditor from '../ui/editor/ChapterEditor.vue'
import { IS_MAC } from '../ui/common/shortcuts.ts'
import type { MenuEntry } from '../application/desktop_shell.ts'

/**
 * 应用级集成测试（App.test.ts、ui/app_shell/Workspace.test.ts）共用的挂载与查找工具：
 * 以内存服务挂载整个应用，按界面文字或结构查找元素。
 */

export const PATH = '/文稿/毕业论文'

/** 平台的命令键：macOS 为 ⌘，其他平台为 Ctrl（与菜单快捷键一致）。 */
export const MOD = IS_MAC ? { metaKey: true } : { ctrlKey: true }

export const tree: ChapterTree = [
  { id: 'a', title: '绪论', children: [{ id: 'a1', title: '背景', children: [] }] },
  { id: 'b', title: '方法', children: [] },
]

export function seededServices() {
  const services = createMemoryServices()
  const document = createDocument(
    '毕业论文',
    tree,
    new Map([
      ['a', '引言'],
      ['a1', ''],
      ['b', '方法正文'],
    ]),
  )
  if (!document.ok) throw new Error('fixture')
  services.storage.seed(PATH, document.document)
  return services
}

const mounted: VueWrapper[] = []

export async function mountApp(services = createMemoryServices()) {
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [APP_SERVICES as symbol]: services } },
  })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

/** 在测试中途卸载应用（如模拟重新打开项目）。 */
export function unmountApp(wrapper: VueWrapper): void {
  wrapper.unmount()
  mounted.splice(mounted.indexOf(wrapper), 1)
}

/** 卸载本文件挂载的应用并恢复真实计时器：在测试文件中 afterEach(unmountAll)。 */
export function unmountAll(): void {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.useRealTimers()
}

export function rowTexts(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.chapter-tree__row').map((row) => row.text())
}

/** 打开菜单（文档菜单、节点菜单）中的一项；菜单项旁可能显示快捷键，按名称查找。 */
export function menuItem(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('[role="menu"] button').find((b) => b.find('.popup-menu__label').text() === label)
  if (!found) throw new Error(`找不到菜单项：${label}`)
  return found
}

export async function documentMenu(wrapper: VueWrapper, label: string) {
  await wrapper.find('.document-title__button').trigger('click')
  await menuItem(wrapper, label).trigger('click')
}

/** 自动保存正常时界面不显示保存状态；测试从工作区上的标记读取。 */
export function saveState(wrapper: VueWrapper): string | undefined {
  return wrapper.find('.workspace').attributes('data-save-status')
}

/** 经文档名菜单重命名文档。 */
export async function renameDocument(wrapper: VueWrapper, title: string) {
  await documentMenu(wrapper, '重命名')
  await flushPromises()
  const input = wrapper.find<HTMLInputElement>('.document-title__input')
  await input.setValue(title)
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
}

/** 经工具栏的导出菜单导出 PDF：打开排版设置，按"导出…"后选择保存位置并导出。 */
export async function exportPdf(wrapper: VueWrapper) {
  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出为 PDF…').trigger('click')
  await flushPromises()
  await button(wrapper, '导出…').trigger('click')
  await flushPromises()
}

/** 工具栏中的文档名（显示文字）。 */
export function documentTitle(wrapper: VueWrapper): string {
  return wrapper.find('.document-title__text').text()
}

/** 按文字查找按钮；菜单项只比较名称（旁边可能显示快捷键）。 */
export function button(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('button').find((candidate) => {
    const menuLabel = candidate.find('.popup-menu__label')
    const text = menuLabel.exists() ? menuLabel.text() : candidate.text()
    return text === label || candidate.attributes('aria-label') === label
  })
  if (!found) throw new Error(`找不到按钮：${label}`)
  return found
}

export function editorView(wrapper: VueWrapper): EditorView {
  const view = (wrapper.findComponent(ChapterEditor).vm as unknown as { getView(): EditorView | null }).getView()
  if (!view) throw new Error('editor not mounted')
  return view
}

export function typeAtEnd(view: EditorView, text: string): void {
  view.dispatch(view.state.tr.insertText(text, Selection.atEnd(view.state.doc).from))
}

/** 编辑器中的可见文字。 */
export function editorText(wrapper: VueWrapper): string {
  return editorView(wrapper).state.doc.textContent
}

/** 菜单栏中 id 对应的项（MemoryShell 记录的最近一次菜单栏）。 */
export function appMenuItem(services: ReturnType<typeof createMemoryServices>, id: string) {
  const visit = (entries: readonly MenuEntry[]): Extract<MenuEntry, { id: string }> | null => {
    for (const entry of entries) {
      if ('separator' in entry || 'role' in entry) continue
      if (entry.id === id) return entry
      const inner = entry.submenu ? visit(entry.submenu) : null
      if (inner) return inner
    }
    return null
  }
  for (const menu of services.shell.appMenus ?? []) {
    const found = visit(menu.items)
    if (found) return found
  }
  throw new Error(`菜单栏中没有 ${id}`)
}

/** 在正文中按键：经过编辑器（ProseMirror）再冒泡到工作区。 */
export function pressInEditor(wrapper: VueWrapper, init: KeyboardEventInit): KeyboardEvent {
  const view = editorView(wrapper)
  view.focus()
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  view.dom.dispatchEvent(event)
  return event
}

export function focusedChapter(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset.chapterId
}
