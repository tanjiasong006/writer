import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import PdfLayoutDialog from './PdfLayoutDialog.vue'
import type { PdfLayoutSettings } from '../../domain/pdf_layout/pdf_layout.ts'

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

async function render(settings: PdfLayoutSettings = {}, action: 'export' | 'save' = 'export') {
  const preview = async () => ({ ok: true as const, value: ['<svg/>'] })
  const wrapper = mount(PdfLayoutDialog, { props: { settings, action, preview }, attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const group = (wrapper: VueWrapper, label: string) => wrapper.find(`[role="radiogroup"][aria-label="${label}"]`)
const choose = (wrapper: VueWrapper, label: string, option: string) =>
  group(wrapper, label).findAll('[role="radio"]').find((r) => r.text() === option)!.trigger('click')
const checkbox = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('label').find((l) => l.text() === label)!.find('input')
const buttonNamed = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)!

test('显示当前设置（未改的项为默认值），焦点在第一个选项', async () => {
  const wrapper = await render({ paper: 'b5', toc: false })
  const selected = (label: string) => group(wrapper, label).find('[aria-checked="true"]').text()
  expect(selected('纸张')).toBe('B5')
  expect(selected('页边距')).toBe('标准')
  expect(selected('正文字号')).toBe('小四')
  expect((checkbox(wrapper, '目录').element as HTMLInputElement).checked).toBe(false)
  expect((checkbox(wrapper, '封面').element as HTMLInputElement).checked).toBe(true)
  // 关闭目录时目录层级不可用。
  expect(group(wrapper, '目录层级').attributes('aria-disabled')).toBe('true')
  // 配置不等于任何版式：版式都不选中，焦点在版式的第一项。
  expect(group(wrapper, '版式').find('[aria-checked="true"]').exists()).toBe(false)
  expect(document.activeElement?.textContent?.trim()).toBe('标准')
  expect(buttonNamed(wrapper, '导出…').exists()).toBe(true)
})

test('修改只作用于草稿：完成时提交只含改动的设置，取消时放弃', async () => {
  const wrapper = await render({}, 'save')
  await choose(wrapper, '纸张', 'A5')
  await choose(wrapper, '章节编号', '第 1 章')
  await checkbox(wrapper, '封面').setValue(false)
  // 改回默认值的项不再记录。
  await choose(wrapper, '纸张', 'A4')
  expect(wrapper.emitted('submit')).toBeUndefined()
  await buttonNamed(wrapper, '完成').trigger('click')
  expect(wrapper.emitted('submit')).toEqual([[{ chapterNumber: 'chapter', cover: false }]])

  const other = await render({ table: 'grid' })
  await choose(other, '表格', '三线表')
  await buttonNamed(other, '取消').trigger('click')
  expect(other.emitted('cancel')).toHaveLength(1)
  expect(other.emitted('submit')).toBeUndefined()
})

test('版式：选择后整体替换草稿；与某个版式相同时标为选中，改动任一项后不再选中', async () => {
  const wrapper = await render({ paper: 'a5', margin: 'wide' }, 'save')
  const selected = (label: string) => group(wrapper, label).find('[aria-checked="true"]')
  await choose(wrapper, '版式', '学术')
  expect(selected('版式').text()).toBe('学术')
  // 原有改动不保留。
  expect(selected('纸张').text()).toBe('A4')
  expect(selected('页边距').text()).toBe('标准')
  expect(selected('章节编号').text()).toBe('第 1 章')

  await choose(wrapper, '行距', '标准')
  expect(selected('版式').exists()).toBe(false)
  await choose(wrapper, '行距', '紧凑')
  expect(selected('版式').text()).toBe('学术')

  await choose(wrapper, '版式', '简洁')
  expect((checkbox(wrapper, '封面').element as HTMLInputElement).checked).toBe(false)
  await buttonNamed(wrapper, '完成').trigger('click')
  expect(wrapper.emitted('submit')).toEqual([
    [{ cover: false, toc: false, chapterNewPage: false, paragraph: 'spacing', header: 'title', pageNumber: 'total' }],
  ])

  const standard = await render({})
  expect(group(standard, '版式').find('[aria-checked="true"]').text()).toBe('标准')
})

test('恢复默认：清空全部改动；没有改动时不可用', async () => {
  const wrapper = await render({ paper: 'b5', header: 'none' })
  const reset = buttonNamed(wrapper, '恢复默认')
  expect((reset.element as HTMLButtonElement).disabled).toBe(false)
  await reset.trigger('click')
  expect((reset.element as HTMLButtonElement).disabled).toBe(true)
  expect(group(wrapper, '纸张').find('[aria-checked="true"]').text()).toBe('A4')
  await buttonNamed(wrapper, '导出…').trigger('click')
  expect(wrapper.emitted('submit')).toEqual([[{}]])
})

test('键盘：Esc 取消；焦点在复选框上时 Enter 等同主按钮；Tab 在对话框内循环', async () => {
  const wrapper = await render()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(wrapper.emitted('cancel')).toHaveLength(1)

  ;(checkbox(wrapper, '封面').element as HTMLInputElement).focus()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  expect(wrapper.emitted('submit')).toEqual([[{}]])

  const primary = buttonNamed(wrapper, '导出…').element as HTMLElement
  primary.focus()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
  expect(document.activeElement?.textContent?.trim()).toBe('标准')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
  expect(document.activeElement).toBe(primary)
})

test('样张全尺寸查看：Esc 只关闭查看层，Enter 不提交；关闭按钮同样回到设置', async () => {
  const wrapper = await render()
  await wrapper.find('.preview__page').trigger('click')
  await flushPromises()
  expect(document.querySelector('.viewer')).not.toBeNull()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flushPromises()
  expect(document.querySelector('.viewer')).toBeNull()
  expect(wrapper.emitted('cancel')).toBeUndefined()
  expect(wrapper.emitted('submit')).toBeUndefined()

  await wrapper.find('.preview__page').trigger('click')
  await flushPromises()
  ;(document.querySelector('[aria-label="关闭样张"]') as HTMLButtonElement).click()
  await flushPromises()
  expect(document.querySelector('.viewer')).toBeNull()
  // 回到设置后按键照常：Esc 取消。
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(wrapper.emitted('cancel')).toHaveLength(1)
})
