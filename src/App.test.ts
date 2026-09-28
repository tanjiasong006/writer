import { afterEach, expect, test, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from './App.vue'
import { APP_SERVICES } from './ui/services.ts'
import { createMemoryServices } from './testing/memory_services.ts'
import { createDocument } from './domain/document/document.ts'
import type { ChapterTree } from './domain/chapter_tree/chapter_tree.ts'
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state'
import { undo, undoDepth } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'
import ChapterEditor from './ui/editor/ChapterEditor.vue'

const PATH = '/文稿/毕业论文'

const tree: ChapterTree = [
  { id: 'a', title: '绪论', children: [{ id: 'a1', title: '背景', children: [] }] },
  { id: 'b', title: '方法', children: [] },
]

function seededServices() {
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

async function mountApp(services = createMemoryServices()) {
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [APP_SERVICES as symbol]: services } },
  })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.useRealTimers()
})

function rowTexts(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.chapter-tree__row').map((row) => row.text())
}

/** 打开菜单（文档菜单、节点菜单）中的一项；菜单项旁可能显示快捷键，按名称查找。 */
function menuItem(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('[role="menu"] button').find((b) => b.find('.popup-menu__label').text() === label)
  if (!found) throw new Error(`找不到菜单项：${label}`)
  return found
}

async function documentMenu(wrapper: VueWrapper, label: string) {
  await wrapper.find('button[aria-label="文档菜单"]').trigger('click')
  await menuItem(wrapper, label).trigger('click')
}

function button(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  if (!found) throw new Error(`找不到按钮：${label}`)
  return found
}

test('没有上次项目时显示欢迎页', async () => {
  const wrapper = await mountApp()
  expect(wrapper.find('.welcome').exists()).toBe(true)
})

test('新建文档：在所选位置创建空项目，标题取文件夹名，并记住该项目', async () => {
  const services = createMemoryServices()
  services.shell.newProjectPath = '/文稿/我的小说'
  const wrapper = await mountApp(services)

  await wrapper.findAll('.welcome__button').find((b) => b.text().startsWith('新建文档'))!.trigger('click')
  await flushPromises()

  expect(wrapper.find('.workspace').exists()).toBe(true)
  expect(wrapper.find<HTMLInputElement>('.workspace__title').element.value).toBe('我的小说')
  expect(wrapper.find('.chapter-tree__empty').exists()).toBe(true)
  expect(services.storage.committed('/文稿/我的小说')?.title).toBe('我的小说')
  expect(services.shell.lastProjectPath).toBe('/文稿/我的小说')
})

test('取消新建对话框：什么也不发生', async () => {
  const wrapper = await mountApp()
  await wrapper.findAll('.welcome__button').find((b) => b.text().startsWith('新建文档'))!.trigger('click')
  await flushPromises()
  expect(wrapper.find('.welcome').exists()).toBe(true)
})

test('启动时重新打开上次的项目，默认选中第一个章节', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)

  expect(rowTexts(wrapper)).toEqual(['1绪论', '1.1背景', '2方法'])
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1绪论')
})

test('上次的项目无法打开：回到欢迎页并说明原因', async () => {
  const services = createMemoryServices()
  services.shell.lastProjectPath = '/已删除'
  const wrapper = await mountApp(services)
  expect(wrapper.find('.welcome__error').text()).toContain('不是 Writer 文档')
})

test('打开失败的原因对用户可见', async () => {
  const services = seededServices()
  services.shell.projectPath = PATH
  services.storage.failNext({ code: 'content-missing', chapterId: 'b', file: 'ch_2.md' })
  const wrapper = await mountApp(services)
  await wrapper.findAll('.welcome__button').find((b) => b.text().startsWith('打开文档'))!.trigger('click')
  await flushPromises()
  expect(wrapper.find('.welcome__error').text()).toContain('content/ch_2.md')
})

test('界面状态：选中章节与折叠状态随项目恢复，失效的章节被忽略', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.uiStates.set(
    PATH,
    JSON.stringify({ version: 1, selectedId: 'b', collapsedIds: ['a', 'ghost'] }),
  )
  const wrapper = await mountApp(services)

  expect(rowTexts(wrapper)).toEqual(['1绪论', '2方法'])
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('2方法')
})

test('界面状态变化后写回项目', async () => {
  vi.useFakeTimers()
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)

  await wrapper.findAll('.chapter-tree__row')[2].trigger('click') // 方法
  await vi.advanceTimersByTimeAsync(600)
  expect(JSON.parse(services.shell.uiStates.get(PATH)!)).toEqual({
    version: 1,
    selectedId: 'b',
    collapsedIds: [],
  })
})

test('Cmd/Ctrl+S 保存结构修改', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)

  await wrapper.find('.chapter-tree__add').trigger('click') // 在选中章节（绪论）之后新建
  await wrapper.find('.chapter-tree__rename-input').setValue('相关工作')
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown', { key: 'Enter' })
  expect(wrapper.find('.save-status').text()).toBe('未保存')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()

  const committed = services.storage.committed(PATH)!
  expect(committed.tree.map((node) => node.title)).toEqual(['绪论', '相关工作', '方法'])
  expect(wrapper.find('.save-status').text()).toBe('已保存')
})

test('保存失败：状态显示失败原因并可重试', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await wrapper.find('.chapter-tree__add').trigger('click')
  services.storage.failNext({ code: 'io', operation: 'write', path: 'x', message: '磁盘已满' })
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
  await flushPromises()

  expect(wrapper.find('.save-status').text()).toContain('保存失败')
  expect(wrapper.find('.save-status').text()).toContain('磁盘已满')

  await button(wrapper, '重试').trigger('click')
  await flushPromises()
  expect(wrapper.find('.save-status').text()).toBe('已保存')
})

test('删除空白章节不确认；删除有正文的章节需要确认', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)

  await wrapper.findAll('.chapter-tree__row')[1].find('.chapter-tree__more').trigger('click')
  await button(wrapper, '删除').trigger('click')
  expect(rowTexts(wrapper)).toEqual(['1绪论', '2方法'])

  await wrapper.findAll('.chapter-tree__row')[1].find('.chapter-tree__more').trigger('click')
  await button(wrapper, '删除').trigger('click')
  expect(wrapper.find('.chapter-manager__confirm').text()).toContain('包含正文')
})

test('删除正在编辑的章节：编辑器切到相邻章节，之后新建章节正常', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('1绪论')

  await wrapper.findAll('.chapter-tree__row')[0].find('.chapter-tree__more').trigger('click')
  await button(wrapper, '删除').trigger('click')
  await button(wrapper, '删除').trigger('click')
  await flushPromises()
  expect(rowTexts(wrapper)).toEqual(['1方法'])
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('1方法')

  await wrapper.find('.chapter-tree__add').trigger('click')
  await flushPromises()
  expect(wrapper.find('.chapter-manager__error').exists()).toBe(false)
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown', { key: 'Escape' })
  expect(rowTexts(wrapper)).toEqual(['1方法', '2未命名章节'])
})

test('窗口标题显示当前文档名，回到欢迎页时恢复', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  expect(services.shell.windowTitle).toBe('毕业论文 — Writer')

  const input = wrapper.find<HTMLInputElement>('.workspace__title')
  input.element.value = '终稿'
  await input.trigger('change')
  expect(services.shell.windowTitle).toBe('终稿 — Writer')

  await services.shell.requestClose()
  await flushPromises()
  expect(services.shell.windowTitle).toBe('Writer')
})

test('修改文档标题', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const input = wrapper.find('.workspace__title')
  await input.setValue('  新标题  ')
  await input.trigger('change')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.title).toBe('新标题')
})

test('关闭窗口：未保存的修改先保存再关闭', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await wrapper.find('.chapter-tree__add').trigger('click')

  expect(await services.shell.requestClose()).toBe(true)
  expect(services.storage.committed(PATH)!.tree).toHaveLength(3)
  expect(services.shell.confirmations).toEqual([])
})

test('关闭窗口：保存失败时询问，用户选择返回则不关闭且修改仍在', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await wrapper.find('.chapter-tree__add').trigger('click')

  services.storage.failNext({ code: 'io', operation: 'write', path: 'x', message: '磁盘已满' })
  services.shell.confirmAnswer = false
  expect(await services.shell.requestClose()).toBe(false)
  expect(services.shell.confirmations[0]).toContain('磁盘已满')
  await flushPromises()
  expect(wrapper.find('.workspace').exists()).toBe(true)
  expect(rowTexts(wrapper)).toHaveLength(4)
})

test('切换项目：先保存当前项目，再打开新项目', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const other = createDocument('另一篇', [], new Map())
  if (!other.ok) throw new Error('fixture')
  services.storage.seed('/文稿/另一篇', other.document)
  const wrapper = await mountApp(services)
  await wrapper.find('.chapter-tree__add').trigger('click')

  services.shell.projectPath = '/文稿/另一篇'
  await documentMenu(wrapper, '打开文档…')
  await flushPromises()

  expect(services.storage.committed(PATH)!.tree).toHaveLength(3)
  expect(wrapper.find<HTMLInputElement>('.workspace__title').element.value).toBe('另一篇')
  expect(services.shell.lastProjectPath).toBe('/文稿/另一篇')
})

test('打开或新建失败时回到原来的项目，并说明原因', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await wrapper.find('.chapter-tree__add').trigger('click')
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown', { key: 'Escape' })

  // 选错了文件夹（不是 Writer 文档）。
  services.shell.projectPath = '/文稿'
  await documentMenu(wrapper, '打开文档…')
  await flushPromises()
  expect(wrapper.find('.workspace').exists()).toBe(true)
  expect(wrapper.find<HTMLInputElement>('.workspace__title').element.value).toBe('毕业论文')
  expect(rowTexts(wrapper)).toHaveLength(4)
  expect(wrapper.find('.app__notice').text()).toContain('不是 Writer 文档')
  expect(services.shell.lastProjectPath).toBe(PATH)
  // 离开前的修改已保存。
  expect(services.storage.committed(PATH)!.tree).toHaveLength(3)

  // 新建到已有内容的位置。
  services.shell.newProjectPath = PATH
  await documentMenu(wrapper, '新建文档…')
  await flushPromises()
  expect(wrapper.find<HTMLInputElement>('.workspace__title').element.value).toBe('毕业论文')
  expect(wrapper.find('.app__notice').text()).toContain('已存在且不为空')
})

test('导出菜单：点击别处或按 Esc 关闭', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)

  await button(wrapper, '导出').trigger('click')
  expect(wrapper.find('.workspace__export-menu').exists()).toBe(true)
  await wrapper.find('.workspace__backdrop').trigger('click')
  expect(wrapper.find('.workspace__export-menu').exists()).toBe(false)

  await button(wrapper, '导出').trigger('click')
  await wrapper.find('.workspace__export-menu').trigger('keydown', { key: 'Escape' })
  expect(wrapper.find('.workspace__export-menu').exists()).toBe(false)
})

test('从系统拖入的文件落在编辑器以外：被取消，不会让页面打开该文件', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)

  const drag = (type: 'dragover' | 'drop', types: string[]) => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(event, 'dataTransfer', { value: { types, dropEffect: 'copy' } })
    wrapper.find('.chapter-tree').element.dispatchEvent(event)
    return event
  }
  expect(drag('dragover', ['Files']).defaultPrevented).toBe(true)
  expect(drag('drop', ['Files']).defaultPrevented).toBe(true)
  // 章节拖拽（非文件）不受影响：是否可放置由章节树自己决定。
  expect(drag('drop', ['text/plain']).defaultPrevented).toBe(false)
})

test('刷新页面的快捷键被屏蔽，不会绕过保存流程', async () => {
  await mountApp()
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  expect(press({ key: 'F5' })).toBe(true)
  expect(press({ key: 'r', ctrlKey: true })).toBe(true)
  expect(press({ key: 'R', metaKey: true, shiftKey: true })).toBe(true)
  expect(press({ key: 'r' })).toBe(false)
})

test('孤儿文件：打开后提示已原样保留', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const open = services.storage.open.bind(services.storage)
  services.storage.open = async (path) => {
    const result = await open(path)
    return result.ok ? { ok: true, value: { ...result.value, orphanFiles: ['ch_9.md'] } } : result
  }
  const wrapper = await mountApp(services)
  expect(wrapper.find('.app__notice').text()).toContain('1 个未被文档引用的文件')
})

function editorView(wrapper: VueWrapper): EditorView {
  const view = (wrapper.findComponent(ChapterEditor).vm as unknown as { getView(): EditorView | null }).getView()
  if (!view) throw new Error('editor not mounted')
  return view
}

function typeAtEnd(view: EditorView, text: string): void {
  view.dispatch(view.state.tr.insertText(text, Selection.atEnd(view.state.doc).from))
}

/** 编辑器中的可见文字。 */
function editorText(wrapper: VueWrapper): string {
  return editorView(wrapper).state.doc.textContent
}

test('编辑正文：选中章节的正文显示在编辑器中，修改后保存到该章节', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  expect(wrapper.find('.chapter-editor__heading').text()).toBe('1绪论')
  expect(editorText(wrapper)).toBe('引言')

  typeAtEnd(editorView(wrapper), '：长文档写作')
  await flushPromises()
  expect(wrapper.find('.save-status').text()).toBe('未保存')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()

  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言：长文档写作')
  expect([...services.storage.saves[0].changed]).toEqual(['a'])
})

test('切换章节后编辑只写入当前章节', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  typeAtEnd(editorView(wrapper), '1')
  await wrapper.findAll('.chapter-tree__row')[2].trigger('click') // 方法
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2方法')
  expect(editorText(wrapper)).toBe('方法正文')
  typeAtEnd(editorView(wrapper), '2')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  const contents = services.storage.committed(PATH)!.contents
  expect(contents.get('a')).toBe('引言1')
  expect(contents.get('b')).toBe('方法正文2')
  expect(contents.get('a1')).toBe('')
})

test('自动保存：停止输入后自动写盘', async () => {
  vi.useFakeTimers()
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await vi.advanceTimersByTimeAsync(0)

  typeAtEnd(editorView(wrapper), '！')
  await vi.advanceTimersByTimeAsync(1500)
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言！')
  expect(wrapper.find('.save-status').text()).toBe('已保存')
})

test('新建章节后编辑器切换到新章节', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  await wrapper.find('.chapter-tree__add').trigger('click')
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown', { key: 'Escape' })
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2未命名章节')
  expect(editorText(wrapper)).toBe('')
})

test('键盘：↓ 切换章节，Enter 进入正文（预览中也回到编辑），Alt+Shift+↑ 移动章节并保存', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  const label = (id: string) => wrapper.find(`.chapter-tree__label[data-chapter-id="${id}"]`)

  await label('a').trigger('keydown', { key: 'ArrowDown' })
  await label('a1').trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2方法')

  await button(wrapper, '预览').trigger('click')
  await label('b').trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(editorView(wrapper).hasFocus()).toBe(true)

  await label('b').trigger('keydown', { key: 'ArrowUp', altKey: true, shiftKey: true })
  await flushPromises()
  expect(rowTexts(wrapper)).toEqual(['1方法', '2绪论', '2.1背景'])
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.tree.map((node) => node.id)).toEqual(['b', 'a'])
  expect(services.storage.committed(PATH)!.contents.get('b')).toBe('方法正文')
})

test('工具栏：粗体作用于编辑器选区并进入正文', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  const view = editorView(wrapper)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))

  await wrapper.find('button[aria-label="粗体"]').trigger('click')
  expect(view.dom.querySelector('strong')?.textContent).toBe('引言')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('**引言**')
})

test('插入图片：复制进项目并在光标处插入引用', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.imagePath = '/Users/我/图片/实验装置.png'
  const wrapper = await mountApp(services)
  await flushPromises()
  const view = editorView(wrapper)
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))

  await wrapper.find('button[aria-label="图片"]').trigger('click')
  await flushPromises()

  expect(services.storage.importedAssets).toEqual([
    { path: PATH, sourcePath: '/Users/我/图片/实验装置.png' },
  ])
  // 图片按项目内的文件显示。
  expect(view.dom.querySelector('.editor-image img')?.getAttribute('src')).toBe(
    'file:///文稿/毕业论文/assets/实验装置.png',
  )
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言\n\n![实验装置](../assets/实验装置.png)')
})

test('插入图片：取消选择不做任何事；导入失败显示原因', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  await wrapper.find('button[aria-label="图片"]').trigger('click')
  await flushPromises()
  expect(services.storage.importedAssets).toEqual([])

  services.shell.imagePath = '/x/a.bmp'
  services.storage.failNext({ code: 'asset-unsupported' })
  await wrapper.find('button[aria-label="图片"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('.workspace__error').text()).toContain('PNG、JPG 或 GIF')
  expect(editorText(wrapper)).toBe('引言')
})

test('插入图片期间切换了章节：图片追加到发起请求的章节，不插错位置', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  services.shell.pickImageFile = async () => {
    await wrapper.findAll('.chapter-tree__row')[2].trigger('click') // 切到「方法」
    return '/图/a.png'
  }
  await wrapper.find('button[aria-label="图片"]').trigger('click')
  await flushPromises()

  expect(editorText(wrapper)).toBe('方法正文')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  const contents = services.storage.committed(PATH)!.contents
  expect(contents.get('a')).toBe('引言\n\n![a](../assets/a.png)\n')
  expect(contents.get('b')).toBe('方法正文')
})

test('文档样式：修改正文字体即时作用于编辑器，不改变正文与撤销历史；预览、导出使用同一主题；重开后仍在', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.exportPath = '/导出/毕业论文.pdf'
  const wrapper = await mountApp(services)
  await flushPromises()
  const view = editorView(wrapper)
  typeAtEnd(view, '！')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  const depth = undoDepth(view.state)
  const doc = view.state.doc

  await button(wrapper, '样式').trigger('click')
  await wrapper.find('[aria-label="正文字体"]').findAll('button')[1].trigger('click') // 黑体
  await wrapper.findAll('.style-panel select')[2].setValue('2') // 行距
  await flushPromises()

  // 编辑器：同一个视图、文档与撤销历史不变，只改变 CSS 变量。
  expect(editorView(wrapper)).toBe(view)
  expect(view.state.doc).toBe(doc)
  expect(undoDepth(view.state)).toBe(depth)
  const root = wrapper.find('.chapter-editor').element as HTMLElement
  expect(root.style.getPropertyValue('--doc-body-font')).toContain('Arial')
  expect(root.style.getPropertyValue('--doc-line-height')).toBe('2')
  expect(wrapper.find('.save-status').text()).toBe('未保存')

  // 保存：只提交样式，不携带任何正文。
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  expect(services.storage.saves).toHaveLength(2)
  expect(services.storage.saves[1].changed.size).toBe(0)
  expect(services.storage.committed(PATH)!.style.overrides).toEqual({ bodyFont: 'sans', lineHeight: 2 })
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言！')

  // 预览与导出使用同一套语义样式。
  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出 PDF').trigger('click')
  await flushPromises()
  expect(services.output.exports[0].request.theme.body).toMatchObject({ font: 'sans', lineHeight: 2 })
  await button(wrapper, '预览').trigger('click')
  await flushPromises()
  expect(services.output.previews.at(-1)!.theme.body).toMatchObject({ font: 'sans', lineHeight: 2 })
  const preview = wrapper.find('.document-preview').element as HTMLElement
  expect(preview.style.getPropertyValue('--doc-line-height')).toBe('2')

  // 重新打开项目：样式恢复。
  wrapper.unmount()
  mounted.splice(mounted.indexOf(wrapper), 1)
  const reopened = await mountApp(services)
  await flushPromises()
  const editorRoot = reopened.find('.chapter-editor').element as HTMLElement
  expect(editorRoot.style.getPropertyValue('--doc-body-font')).toContain('Arial')
  await button(reopened, '样式').trigger('click')
  expect(reopened.find('[aria-label="正文字体"] [aria-pressed="true"]').text()).toBe('黑体')
})

test('图片布局：在编辑器中调整后按图片保存到文档样式，正文 Markdown 不变；撤销恢复', async () => {
  const services = createMemoryServices()
  const seeded = createDocument(
    '图文',
    [{ id: 'a', title: '装置', children: [] }],
    new Map([['a', '![装置](../assets/装置.png)\n\n![曲线](../assets/曲线.png)\n']]),
  )
  if (!seeded.ok) throw new Error('fixture')
  services.storage.seed(PATH, seeded.document)
  services.shell.lastProjectPath = PATH
  services.shell.exportPath = '/导出/图文.docx'
  const wrapper = await mountApp(services)
  await flushPromises()

  const view = editorView(wrapper)
  let second = -1
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'figure' && node.attrs.src === '../assets/曲线.png') second = pos
  })
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, second)))
  await flushPromises()
  await button(wrapper, '小').trigger('click')
  await wrapper.find('button[aria-label="靠右"]').trigger('click')
  await flushPromises()

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  const committed = services.storage.committed(PATH)!
  expect([...committed.style.images]).toEqual([['assets/曲线.png', { size: 'small', align: 'right' }]])
  expect(committed.contents.get('a')).toBe('![装置](../assets/装置.png)\n\n![曲线](../assets/曲线.png)\n')
  expect(services.storage.saves[0].changed.size).toBe(0)

  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出 Word（.docx）').trigger('click')
  await flushPromises()
  expect(services.output.exports[0].request.images).toEqual({ 'assets/曲线.png': { size: 'small', align: 'right' } })

  undo(view.state, view.dispatch)
  undo(view.state, view.dispatch)
  await flushPromises()
  expect(wrapper.find('.save-status').text()).toBe('未保存')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.style.images.size).toBe(0)
})

test('全文预览：显示所有章节，编辑后刷新，点击章节同步选中', async () => {
  vi.useFakeTimers()
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await vi.advanceTimersByTimeAsync(0)

  await button(wrapper, '预览').trigger('click')
  await vi.advanceTimersByTimeAsync(0)
  expect(services.output.previews[0].chapters.map((c) => [c.number.join('.'), c.title])).toEqual([
    ['1', '绪论'],
    ['1.1', '背景'],
    ['2', '方法'],
  ])
  expect(wrapper.find('.document-preview').text()).toContain('方法正文')
  expect(wrapper.findComponent(ChapterEditor).exists()).toBe(false)

  // 在章节树中重命名，预览随之刷新。
  await wrapper.findAll('.chapter-tree__row')[2].find('.chapter-tree__more').trigger('click')
  await menuItem(wrapper, '重命名').trigger('click')
  await wrapper.find('.chapter-tree__rename-input').setValue('研究方法')
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown', { key: 'Enter' })
  await vi.advanceTimersByTimeAsync(500)
  expect(wrapper.find('.document-preview').text()).toContain('研究方法')

  await wrapper.find('section[data-chapter-id="b"]').trigger('click')
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('2研究方法')

  await button(wrapper, '预览').trigger('click') // 再次点击回到编辑
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2研究方法')
})

test('全文预览失败时显示原因', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.output.failNext({ code: 'unknown', message: '渲染进程无响应' })
  const wrapper = await mountApp(services)
  await button(wrapper, '预览').trigger('click')
  await flushPromises()
  expect(wrapper.find('.workspace__preview-error').text()).toContain('渲染进程无响应')
})

test('导出 Word：选择位置后导出当前文档（含未保存修改），完成后提示', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.exportPath = '/导出/毕业论文.docx'
  const wrapper = await mountApp(services)
  await flushPromises()
  typeAtEnd(editorView(wrapper), '（未保存）')

  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出 Word（.docx）').trigger('click')
  await flushPromises()

  expect(services.output.exports).toHaveLength(1)
  const exported = services.output.exports[0]
  expect(exported.format).toBe('docx')
  expect(exported.targetPath).toBe('/导出/毕业论文.docx')
  expect(exported.request.chapters[0].markdown).toBe('引言（未保存）')
  expect(wrapper.find('.workspace__notice').text()).toContain('已导出 毕业论文.docx')

  await button(wrapper, '在文件夹中显示').trigger('click')
  expect(services.shell.revealed).toEqual(['/导出/毕业论文.docx'])
})

test('导出：取消选择位置不导出；失败时显示原因；图片缺失时提示', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出 PDF').trigger('click')
  await flushPromises()
  expect(services.output.exports).toHaveLength(0)

  services.shell.exportPath = '/导出/a.pdf'
  services.output.failNext({ code: 'no-cjk-font' })
  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出 PDF').trigger('click')
  await flushPromises()
  expect(wrapper.find('.workspace__error').text()).toContain('中文的字体')

  services.output.missingImages = ['../assets/丢失.png']
  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出 PDF').trigger('click')
  await flushPromises()
  expect(wrapper.find('.workspace__notice').text()).toContain('1 张图片无法嵌入')
})

test('大文档：1000 个章节、多级嵌套可以打开、编辑、保存', async () => {
  const services = createMemoryServices()
  const tree: ChapterTree = Array.from({ length: 100 }, (_, i) => ({
    id: `c${i}`,
    title: `第 ${i + 1} 章`,
    children: Array.from({ length: 9 }, (_, j) => ({
      id: `c${i}-${j}`,
      title: `第 ${j + 1} 节`,
      children: [],
    })),
  }))
  const contents = new Map<string, string>()
  for (const chapter of tree) {
    contents.set(chapter.id, '正文'.repeat(100))
    for (const child of chapter.children) contents.set(child.id, '')
  }
  const document = createDocument('大文档', tree, contents)
  if (!document.ok) throw new Error('fixture')
  services.storage.seed(PATH, document.document)
  services.shell.lastProjectPath = PATH

  const started = performance.now()
  const wrapper = await mountApp(services)
  await flushPromises()
  expect(wrapper.findAll('.chapter-tree__row')).toHaveLength(1000)
  expect(wrapper.findAll('.chapter-tree__row').at(-1)!.text()).toBe('100.9第 9 节')

  typeAtEnd(editorView(wrapper), '！')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
  await flushPromises()
  expect([...services.storage.saves[0].changed]).toEqual(['c0'])
  // 宽松上限，只用于发现数量级的退化（happy-dom 比真实浏览器慢）。
  expect(performance.now() - started).toBeLessThan(10_000)
})

test('项目已在另一个 Writer 中打开：说明原因', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.storage.failNext({ code: 'project-locked' })
  const wrapper = await mountApp(services)
  expect(wrapper.find('.welcome__error').text()).toContain('另一个 Writer 窗口中打开')
})

test('关闭窗口与退出应用同时触发：只保存一次、只询问一次', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await wrapper.find('.chapter-tree__add').trigger('click')
  services.storage.failNext(
    { code: 'io', operation: 'write', path: 'x', message: '磁盘已满' },
    { code: 'io', operation: 'write', path: 'x', message: '磁盘已满' },
  )
  services.shell.confirmAnswer = false

  const [first, second] = await Promise.all([
    services.shell.requestClose(),
    services.shell.requestClose(),
  ])
  expect([first, second]).toEqual([false, false])
  expect(services.shell.confirmations).toHaveLength(1)
})

test('全文预览中按 Esc 回到编辑，焦点回到正文', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await button(wrapper, '预览').trigger('click')
  await flushPromises()
  expect(wrapper.find('.document-preview').exists()).toBe(true)

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  await flushPromises()
  expect(wrapper.find('.document-preview').exists()).toBe(false)
  expect(document.activeElement?.classList.contains('chapter-editor__content')).toBe(true)
})

test('Cmd/Ctrl+O 打开文档（先保存当前项目）', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const other = createDocument('另一篇', [], new Map())
  if (!other.ok) throw new Error('fixture')
  services.storage.seed('/文稿/另一篇', other.document)
  const wrapper = await mountApp(services)

  services.shell.projectPath = '/文稿/另一篇'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true, cancelable: true }))
  await flushPromises()
  expect(wrapper.find<HTMLInputElement>('.workspace__title').element.value).toBe('另一篇')
})

test('侧栏宽度：分隔线可用方向键调整，限制在 180–480px', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const resizer = wrapper.find('.workspace__resizer')
  const width = () => Number(resizer.attributes('aria-valuenow'))
  const start = width()
  await resizer.trigger('keydown', { key: 'ArrowRight' })
  expect(width()).toBe(start + 16)
  await resizer.trigger('keydown', { key: 'Home' })
  expect(width()).toBe(180)
  await resizer.trigger('keydown', { key: 'ArrowLeft' })
  expect(width()).toBe(180)
  await resizer.trigger('dblclick')
  expect(width()).toBe(260)
})

test('顶栏的正文工具反映编辑器状态：在代码块中粗体不可用', async () => {
  const services = createMemoryServices()
  const doc = createDocument('代码', [{ id: 'a', title: '代码', children: [] }], new Map([['a', '```\ncode\n```\n']]))
  if (!doc.ok) throw new Error('fixture')
  services.storage.seed(PATH, doc.document)
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const view = wrapper.findComponent(ChapterEditor).vm.getView() as EditorView
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  await flushPromises()
  expect(wrapper.find('.workspace__bar button[aria-label="粗体"]').attributes('disabled')).toBeDefined()
  expect(wrapper.find('.workspace__bar button[aria-label="代码块"]').attributes('aria-pressed')).toBe('true')
})
