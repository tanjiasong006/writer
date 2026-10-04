import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createMemoryServices } from './testing/memory_services.ts'
import { createDocument } from './domain/document/document.ts'
import type { ChapterTree } from './domain/chapter_tree/chapter_tree.ts'
import {
  PATH,
  MOD,
  tree,
  seededServices,
  mountApp,
  unmountAll,
  rowTexts,
  documentMenu,
  renameDocument,
  documentTitle,
  editorView,
  typeAtEnd,
  appMenuItem,
} from './testing/app_harness.ts'

/** 应用级流程：欢迎页、新建 / 打开 / 切换项目、关闭窗口、启动项目、应用级保护。工作区内的操作见 ui/app_shell/Workspace.test.ts。 */

afterEach(unmountAll)

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
  expect(documentTitle(wrapper)).toBe('我的小说')
  expect(wrapper.find('.chapter-tree__empty').exists()).toBe(true)
  expect(services.storage.committed('/文稿/我的小说')?.title).toBe('我的小说')
  expect(services.shell.lastProjectPath).toBe('/文稿/我的小说')
})

test('从模板新建：欢迎页与菜单栏都可以选择模板，章节预先建好，提示在备注中', async () => {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  services.shell.newProjectPath = '/文稿/毕业论文'
  const wrapper = await mountApp(services)

  await wrapper.findAll('.welcome__template').find((b) => b.text() === '论文')!.trigger('click')
  await flushPromises()
  expect(rowTexts(wrapper).slice(0, 4)).toEqual(['1绪论', '1.1研究背景', '1.2研究内容', '1.3论文结构'])
  expect(services.storage.committed('/文稿/毕业论文')!.tree[0]!.note).toContain('研究背景')

  services.shell.newProjectPath = '/文稿/年度报告'
  services.shell.chooseMenuItem('file:template-report')
  await flushPromises()
  expect(documentTitle(wrapper)).toBe('年度报告')
  expect(rowTexts(wrapper)[0]).toBe('1概述')
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

test('窗口标题显示当前文档名，回到欢迎页时恢复', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  expect(services.shell.windowTitle).toBe('毕业论文 — Writer')

  await renameDocument(wrapper, '终稿')
  expect(services.shell.windowTitle).toBe('终稿 — Writer')

  await services.shell.requestClose()
  await flushPromises()
  expect(services.shell.windowTitle).toBe('Writer')
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
  expect(documentTitle(wrapper)).toBe('另一篇')
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
  expect(documentTitle(wrapper)).toBe('毕业论文')
  expect(rowTexts(wrapper)).toHaveLength(4)
  expect(wrapper.find('.app__notice').text()).toContain('不是 Writer 文档')
  expect(services.shell.lastProjectPath).toBe(PATH)
  // 离开前的修改已保存。
  expect(services.storage.committed(PATH)!.tree).toHaveLength(3)

  // 新建到已有内容的位置。
  services.shell.newProjectPath = PATH
  await documentMenu(wrapper, '新建文档…')
  await flushPromises()
  expect(documentTitle(wrapper)).toBe('毕业论文')
  expect(wrapper.find('.app__notice').text()).toContain('已存在且不为空')
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
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
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

test('Cmd/Ctrl+Shift+O 打开文档（先保存当前项目）', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const other = createDocument('另一篇', [], new Map())
  if (!other.ok) throw new Error('fixture')
  services.storage.seed('/文稿/另一篇', other.document)
  const wrapper = await mountApp(services)

  services.shell.projectPath = '/文稿/另一篇'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'O', shiftKey: true, ...MOD, cancelable: true }))
  await flushPromises()
  expect(documentTitle(wrapper)).toBe('另一篇')
})

test('网页的默认右键菜单不出现；输入框保留系统菜单', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const onBar = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  wrapper.find('.workspace__bar').element.dispatchEvent(onBar)
  expect(onBar.defaultPrevented).toBe(true)

  await wrapper.find('.chapter-tree__add').trigger('click')
  const inInput = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  wrapper.find('.chapter-tree__rename-input').element.dispatchEvent(inInput)
  expect(inInput.defaultPrevented).toBe(false)
})

test('开发版指定的启动项目（WRITER_OPEN_PROJECT）优先于上次打开的项目', async () => {
  const services = seededServices()
  const other = createDocument('测试项目', [{ id: 't', title: '测试', children: [] }], new Map([['t', '']]))
  if (!other.ok) throw new Error('fixture')
  services.storage.seed('/tmp/测试项目', other.document)
  services.shell.lastProjectPath = PATH
  services.shell.startupProject = '/tmp/测试项目'
  const wrapper = await mountApp(services)
  expect(documentTitle(wrapper)).toBe('测试项目')
  expect(services.shell.lastProjectPath).toBe('/tmp/测试项目')
})

test('外观：启动时应用保存的偏好；欢迎页与工作区的"显示 → 外观"切换同一个偏好', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.preferences.set('appearance', 'dark')
  await mountApp(services)
  expect(services.shell.appearance).toBe('dark')
  expect(appMenuItem(services, 'appearance:dark').checked).toBe(true)

  services.shell.chooseMenuItem('appearance:light')
  await flushPromises()
  expect(services.shell.appearance).toBe('light')
  expect(services.shell.getPreference('appearance')).toBe('light')
  expect(appMenuItem(services, 'appearance:light').checked).toBe(true)
  expect(appMenuItem(services, 'appearance:dark').checked).toBe(false)

  services.shell.lastProjectPath = PATH
  unmountAll()
  const wrapper = await mountApp(services)
  await flushPromises()
  expect(wrapper.find('.workspace').exists()).toBe(true)
  expect(appMenuItem(services, 'appearance:light').checked).toBe(true)
  services.shell.chooseMenuItem('appearance:system')
  await flushPromises()
  expect(services.shell.appearance).toBe('system')
  expect(services.shell.getPreference('appearance')).toBe('system')
  expect(appMenuItem(services, 'appearance:system').checked).toBe(true)
})

test('外观：保存的值无法识别时跟随系统', async () => {
  const services = createMemoryServices()
  services.shell.preferences.set('appearance', 'sepia')
  await mountApp(services)
  expect(services.shell.appearance).toBe('system')
})
