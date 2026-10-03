import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { TextSelection } from 'prosemirror-state'
import { createMemoryServices } from '../../testing/memory_services.ts'
import { createDocument } from '../../domain/document/document.ts'
import { PATH, mountApp, unmountAll, editorView, appMenuItem, button } from '../../testing/app_harness.ts'

/** 专注模式（docs/decisions.md 第 15 节）。 */

afterEach(unmountAll)

async function open() {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  const document = createDocument('论文', [{ id: 'a', title: '绪论', children: [] }], new Map([['a', '第一段\n\n第二段\n\n第三段']]))
  if (!document.ok) throw new Error('fixture')
  services.storage.seed(PATH, document.document)
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  return { services, wrapper }
}

test('显示 → 专注模式：全屏，隐藏侧栏，当前段落以外淡化；侧栏偏好不变', async () => {
  const { services, wrapper } = await open()
  const view = editorView(wrapper)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)))
  services.shell.chooseMenuItem('view:focus-mode')
  await flushPromises()
  expect(services.shell.fullscreen).toBe(true)
  expect(appMenuItem(services, 'view:focus-mode').checked).toBe(true)
  expect(wrapper.find('.workspace').classes()).toContain('workspace--focus')
  expect((wrapper.find('.workspace__sidebar').element as HTMLElement).style.display).toBe('none')
  const blocks = [...view.dom.children].filter((child) => child.tagName === 'P')
  expect(blocks.map((block) => block.classList.contains('is-focus-block'))).toEqual([false, true, false])
  expect(services.shell.preferences.get('sidebarVisible') ?? null).toBe(null)

  // 光标移动后，淡化随之改变。
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 13)))
  expect([...view.dom.querySelectorAll('p')].map((block) => block.classList.contains('is-focus-block'))).toEqual([false, false, true])
})

test('工具栏中的“退出专注模式”恢复原样；进入全文阅读时退出专注模式', async () => {
  const { services, wrapper } = await open()
  services.shell.chooseMenuItem('view:focus-mode')
  await flushPromises()
  await button(wrapper, '退出专注模式').trigger('click')
  await flushPromises()
  expect(services.shell.fullscreen).toBe(false)
  expect(wrapper.find('.workspace').classes()).not.toContain('workspace--focus')
  expect(editorView(wrapper).dom.querySelector('.is-focus-block')).toBeNull()

  services.shell.chooseMenuItem('view:focus-mode')
  await flushPromises()
  services.shell.chooseMenuItem('view:reader')
  await flushPromises()
  expect(services.shell.fullscreen).toBe(false)
  expect(appMenuItem(services, 'view:focus-mode').disabled).toBe(true)
})
