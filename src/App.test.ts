import { afterEach, expect, test, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from './App.vue'
import { APP_SERVICES } from './ui/services.ts'
import { createMemoryServices } from './testing/memory_services.ts'
import { createDocument } from './domain/document/document.ts'
import type { ChapterTree } from './domain/chapter_tree/chapter_tree.ts'

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

  await button(wrapper, '新建文档').trigger('click')
  await flushPromises()

  expect(wrapper.find('.workspace').exists()).toBe(true)
  expect(wrapper.find<HTMLInputElement>('.workspace__title').element.value).toBe('我的小说')
  expect(wrapper.find('.chapter-tree__empty').exists()).toBe(true)
  expect(services.storage.committed('/文稿/我的小说')?.title).toBe('我的小说')
  expect(services.shell.lastProjectPath).toBe('/文稿/我的小说')
})

test('取消新建对话框：什么也不发生', async () => {
  const wrapper = await mountApp()
  await button(wrapper, '新建文档').trigger('click')
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
  await button(wrapper, '打开文档').trigger('click')
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

  await button(wrapper, '+').trigger('click') // 在选中章节（绪论）之后新建
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
  await button(wrapper, '+').trigger('click')
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
  await button(wrapper, '+').trigger('click')

  expect(await services.shell.requestClose()).toBe(true)
  expect(services.storage.committed(PATH)!.tree).toHaveLength(3)
  expect(services.shell.confirmations).toEqual([])
})

test('关闭窗口：保存失败时询问，用户选择返回则不关闭且修改仍在', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await button(wrapper, '+').trigger('click')

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
  await button(wrapper, '+').trigger('click')

  services.shell.projectPath = '/文稿/另一篇'
  await button(wrapper, '打开').trigger('click')
  await flushPromises()

  expect(services.storage.committed(PATH)!.tree).toHaveLength(3)
  expect(wrapper.find<HTMLInputElement>('.workspace__title').element.value).toBe('另一篇')
  expect(services.shell.lastProjectPath).toBe('/文稿/另一篇')
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
