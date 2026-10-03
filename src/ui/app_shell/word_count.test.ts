import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { TextSelection } from 'prosemirror-state'
import { PATH, seededServices, mountApp, unmountAll, editorView, typeAtEnd } from '../../testing/app_harness.ts'

/** 字数统计（工作区）。 */

afterEach(unmountAll)

test('工具栏显示本章字数，选中内容时显示选中的字数；输入后随之更新', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  const count = () => wrapper.find('.workspace__count').text()
  expect(count()).toBe('2 字') // 引言

  typeAtEnd(editorView(wrapper), '与 long text')
  await flushPromises()
  expect(count()).toBe('5 字')

  const view = editorView(wrapper)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
  await flushPromises()
  expect(count()).toBe('已选 2 字')
})

test('点击字数打开统计：选中内容、本章与全文；Esc 关闭', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  await wrapper.find('.workspace__count').trigger('click')
  const rows = wrapper.findAll('.word-count tbody tr').map((row) => row.text())
  expect(rows).toEqual(['本章22', '全文66']) // 引言 + 方法正文
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flushPromises()
  expect(wrapper.find('.word-count').exists()).toBe(false)
})
