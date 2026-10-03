import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { setContent, setTitle, type WriterDocument } from '../../domain/document/document.ts'
import { PATH, MOD, seededServices, mountApp, unmountAll, button, editorView, typeAtEnd, editorText, saveState, documentTitle } from '../../testing/app_harness.ts'

/** 其他程序修改了已打开项目的文件（known-risks #4）。 */

afterEach(unmountAll)

async function open() {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  return { services, wrapper }
}

function edit(document: WriterDocument, id: string, text: string): WriterDocument {
  const result = setContent(document, id, text)
  if (!result.ok) throw new Error('fixture')
  return result.document
}

async function focusWindow() {
  window.dispatchEvent(new Event('focus'))
  await flushPromises()
}

test('只在磁盘上被修改的章节：窗口获得焦点时直接载入，不产生未保存的修改', async () => {
  const { services, wrapper } = await open()
  services.storage.modifyOnDisk(PATH, (state) => ({ ...state, document: edit(state.document, 'a', '外部修改的引言') }))
  await focusWindow()
  expect(editorText(wrapper)).toBe('外部修改的引言')
  expect(saveState(wrapper)).toBe('saved')
  expect(wrapper.find('.workspace__external').text()).toContain('已载入在其他程序中修改的“1 绪论”')
})

test('两边都修改：询问；保留 Writer 中的版本时保存覆盖磁盘', async () => {
  const { services, wrapper } = await open()
  typeAtEnd(editorView(wrapper), '本地')
  services.storage.modifyOnDisk(PATH, (state) => ({ ...state, document: edit(state.document, 'a', '外部') }))
  await focusWindow()
  expect(wrapper.find('.external').text()).toContain('1 绪论')
  await button(wrapper, '保留 Writer 中的版本').trigger('click')
  await flushPromises()
  expect(editorText(wrapper)).toBe('引言本地')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言本地')
})

test('两边都修改：使用磁盘上的版本时放弃 Writer 中的修改', async () => {
  const { services, wrapper } = await open()
  typeAtEnd(editorView(wrapper), '本地')
  services.storage.modifyOnDisk(PATH, (state) => ({ ...state, document: edit(state.document, 'a', '外部') }))
  await focusWindow()
  await button(wrapper, '使用磁盘上的版本').trigger('click')
  await flushPromises()
  expect(editorText(wrapper)).toBe('外部')
  expect(saveState(wrapper)).toBe('saved')
})

test('结构（标题）被修改：使用磁盘上的版本时整个文档换成磁盘上的状态', async () => {
  const { services, wrapper } = await open()
  services.storage.modifyOnDisk(PATH, (state) => ({ ...state, document: setTitle(state.document, '新标题') }))
  await focusWindow()
  expect(wrapper.find('.external').text()).toContain('章节结构、标题或文档设置')
  await button(wrapper, '使用磁盘上的版本').trigger('click')
  await flushPromises()
  expect(documentTitle(wrapper)).toBe('新标题')
  expect(saveState(wrapper)).toBe('saved')
})

test('没有修改时什么都不做；Writer 自己的保存不被当作外部修改', async () => {
  const { services, wrapper } = await open()
  typeAtEnd(editorView(wrapper), '本地')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  await focusWindow()
  expect(wrapper.find('.external').exists()).toBe(false)
  expect(wrapper.find('.workspace__external').exists()).toBe(false)
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言本地')
})
