import { afterEach, expect, test } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { TextSelection } from 'prosemirror-state'
import { undo } from 'prosemirror-history'
import { createMemoryServices } from '../../testing/memory_services.ts'
import { createDocument } from '../../domain/document/document.ts'
import { PATH, MOD, mountApp, unmountAll, editorView, editorText, button } from '../../testing/app_harness.ts'

/** 查找与替换（工作区，以整个应用挂载）。 */

afterEach(unmountAll)

async function openDocument() {
  const services = createMemoryServices()
  const document = createDocument(
    '论文',
    [
      { id: 'a', title: '绪论', children: [] },
      { id: 'b', title: '方法', children: [] },
      { id: 'c', title: '结论', children: [] },
    ],
    new Map([
      ['a', '样本与样本'],
      ['b', '没有'],
      ['c', '最后的样本'],
    ]),
  )
  if (!document.ok) throw new Error('fixture')
  services.storage.seed(PATH, document.document)
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  return { services, wrapper }
}

function pressFind(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ...MOD, bubbles: true, cancelable: true }))
}

async function search(wrapper: VueWrapper, text: string): Promise<void> {
  await wrapper.find('input[aria-label="查找"]').setValue(text)
  await flushPromises()
}

function status(wrapper: VueWrapper): string {
  return wrapper.find('.find-bar__status').text()
}

function selectedText(wrapper: VueWrapper): string {
  const { state } = editorView(wrapper)
  return state.doc.textBetween(state.selection.from, state.selection.to)
}

test('⌘F 打开查找栏，焦点在查找框；高亮当前章节中的全部匹配并显示数量', async () => {
  const { wrapper } = await openDocument()
  pressFind()
  await flushPromises()

  const input = wrapper.find('input[aria-label="查找"]')
  expect(document.activeElement).toBe(input.element)
  await search(wrapper, '样本')
  expect(status(wrapper)).toBe('共 2 处')
  expect(wrapper.findAll('.find-match')).toHaveLength(2)

  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(selectedText(wrapper)).toBe('样本')
  expect(status(wrapper)).toBe('第 1 处，共 2 处')
  expect(wrapper.findAll('.find-match.is-current')).toHaveLength(1)

  await search(wrapper, '不存在')
  expect(status(wrapper)).toBe('无结果')
})

test('本章：到最后一处后回到第一处；⇧Enter 后退', async () => {
  const { wrapper } = await openDocument()
  pressFind()
  await flushPromises()
  await search(wrapper, '样本')
  const input = wrapper.find('input[aria-label="查找"]')

  await input.trigger('keydown', { key: 'Enter' })
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(status(wrapper)).toBe('第 2 处，共 2 处')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(status(wrapper)).toBe('第 1 处，共 2 处')
  await input.trigger('keydown', { key: 'Enter', shiftKey: true })
  await flushPromises()
  expect(status(wrapper)).toBe('第 2 处，共 2 处')
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('1绪论')
})

test('全文：当前章节找完后进入下一个有匹配的章节，序号按全文计算', async () => {
  const { wrapper } = await openDocument()
  pressFind()
  await flushPromises()
  await wrapper.find('[role="radiogroup"][aria-label="查找范围"] button:nth-child(2)').trigger('click')
  await search(wrapper, '样本')
  expect(status(wrapper)).toBe('共 3 处')
  const input = wrapper.find('input[aria-label="查找"]')

  for (let i = 0; i < 3; i++) await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('3结论')
  expect(selectedText(wrapper)).toBe('样本')
  expect(status(wrapper)).toBe('第 3 处，共 3 处')

  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('1绪论')
  expect(status(wrapper)).toBe('第 1 处，共 3 处')
})

test('替换当前匹配后前进到下一处；全部替换修改范围内全部章节，各自可以撤销', async () => {
  const { services, wrapper } = await openDocument()
  services.shell.enableAppMenu()
  pressFind()
  await flushPromises()
  services.shell.chooseMenuItem('edit:find-replace')
  await flushPromises()
  await search(wrapper, '样本')
  await wrapper.find('input[aria-label="替换为"]').setValue('案例')

  await wrapper.find('input[aria-label="查找"]').trigger('keydown', { key: 'Enter' })
  await button(wrapper, '替换').trigger('click')
  await flushPromises()
  expect(editorText(wrapper)).toBe('案例与样本')
  expect(selectedText(wrapper)).toBe('样本')

  await wrapper.find('[role="radiogroup"][aria-label="查找范围"] button:nth-child(2)').trigger('click')
  await button(wrapper, '全部替换').trigger('click')
  await flushPromises()
  expect(status(wrapper)).toBe('已替换 2 处')
  expect(editorText(wrapper)).toBe('案例与案例')

  services.shell.chooseMenuItem('file:save')
  await flushPromises()
  const saved = services.storage.committed(PATH)!.contents
  expect(saved.get('c')).toBe('最后的案例')
  expect(saved.get('b')).toBe('没有')

  // 其他章节的替换进入该章节自己的撤销历史。
  await wrapper.findAll('.chapter-tree__row')[2].trigger('click')
  await flushPromises()
  const view = editorView(wrapper)
  undo(view.state, view.dispatch)
  expect(editorText(wrapper)).toBe('最后的样本')
})

test('Esc 关闭查找栏，焦点回到正文并保持选中的匹配；正文中选中的文字作为查找词', async () => {
  const { wrapper } = await openDocument()
  const view = editorView(wrapper)
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4, 6)))
  await flushPromises()
  pressFind()
  await flushPromises()
  const input = wrapper.find<HTMLInputElement>('input[aria-label="查找"]')
  expect(input.element.value).toBe('样本')

  await input.trigger('keydown', { key: 'Escape' })
  await flushPromises()
  expect(wrapper.find('.find-bar').exists()).toBe(false)
  expect(view.hasFocus()).toBe(true)
  expect(selectedText(wrapper)).toBe('样本')
  expect(wrapper.findAll('.find-match')).toHaveLength(0)
})
