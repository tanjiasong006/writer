import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import WordImportDialog from './WordImportDialog.vue'

const wrappers: VueWrapper[] = []
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })
function render(props = { filePath: '', projectName: '', targetDirectory: '' }) {
  const wrapper = mount(WordImportDialog, { props, attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}
const ready = { filePath: '/a.docx', projectName: ' 项目 ', targetDirectory: '/dest' }

test('选择操作交给上层，项目名受控，缺少必填项不能提交', async () => {
  const w = render()
  const buttons = w.findAll('button')
  await buttons[0].trigger('click')
  await buttons[1].trigger('click')
  await w.find('input').setValue('新项目')
  await w.find('form').trigger('submit')
  expect(w.emitted('choose-file')).toHaveLength(1)
  expect(w.emitted('choose-directory')).toHaveLength(1)
  expect(w.emitted('update:projectName')).toEqual([['新项目']])
  expect(w.emitted('submit')).toBeUndefined()
  expect((buttons[3].element as HTMLButtonElement).disabled).toBe(true)
})

test('提交使用最新 props 并去除项目名首尾空白；取消独立发出', async () => {
  const w = render()
  await w.setProps(ready)
  await w.find('form').trigger('submit')
  expect(w.emitted('submit')).toEqual([[{ ...ready, projectName: '项目' }]])
  await w.findAll('button')[2].trigger('click')
  expect(w.emitted('cancel')).toHaveLength(1)
  await w.setProps({ projectName: '  ' })
  await w.find('form').trigger('submit')
  expect(w.emitted('submit')).toHaveLength(1)
})

test('忙碌时禁止所有操作，错误可访问', async () => {
  const w = render(ready)
  await w.setProps({ busy: true, error: '导入失败' })
  expect(w.find('[role=alert]').text()).toBe('导入失败')
  expect(w.find('[role=dialog]').attributes('aria-busy')).toBe('true')
  expect(w.findAll('button').every(b => (b.element as HTMLButtonElement).disabled)).toBe(true)
  await w.find('form').trigger('submit')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(w.emitted('submit')).toBeUndefined()
  expect(w.emitted('cancel')).toBeUndefined()
})

test('焦点循环、Esc 取消并在卸载时恢复焦点', async () => {
  const outside = document.createElement('button')
  document.body.append(outside)
  outside.focus()
  const w = render(ready)
  await flushPromises()
  const buttons = w.findAll('button')
  expect(document.activeElement).toBe(buttons[0].element)
  ;(buttons[3].element as HTMLElement).focus()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
  expect(document.activeElement).toBe(buttons[0].element)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
  expect(document.activeElement).toBe(buttons[3].element)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(w.emitted('cancel')).toHaveLength(1)
  w.unmount()
  wrappers.pop()
  expect(document.activeElement).toBe(outside)
  outside.remove()
})
