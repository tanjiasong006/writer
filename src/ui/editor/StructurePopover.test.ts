import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import StructurePopover from './StructurePopover.vue'

/** 化学结构式浮层：按名称查找、直接输入 SMILES、预览（docs/decisions.md 第 22 节）。 */

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

async function open(smiles: string) {
  const wrapper = mount(StructurePopover, { attachTo: document.body, props: { anchor: { x: 100, y: 100 }, smiles } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const input = (wrapper: VueWrapper) => wrapper.find('.structure-popover__search')
const key = (wrapper: VueWrapper, init: KeyboardEventInit) => input(wrapper).trigger('keydown', init)
const options = (wrapper: VueWrapper) => wrapper.findAll('.structure-popover__option').map((option) => option.find('.structure-popover__name').text())
const active = (wrapper: VueWrapper) => wrapper.find('.structure-popover__option--active .structure-popover__name')

test('按名称查找：默认第一个匹配，预览画出它；Enter 得到它的 SMILES', async () => {
  const wrapper = await open('')
  await input(wrapper).setValue('苯')
  expect(options(wrapper)[0]).toBe('苯')
  expect(active(wrapper).text()).toBe('苯')
  expect(wrapper.find('.structure-popover__preview svg').exists()).toBe(true)
  expect(wrapper.find('.structure-popover__smiles').text()).toBe('苯 · C1=CC=CC=C1')
  await key(wrapper, { key: 'ArrowDown' })
  expect(active(wrapper).text()).toBe(options(wrapper)[1])
  await key(wrapper, { key: 'ArrowUp' })
  await key(wrapper, { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([['C1=CC=CC=C1']])
})

test('输入有效的 SMILES 时默认使用它；↓ 才选择名称的匹配', async () => {
  const wrapper = await open('')
  await input(wrapper).setValue('CCO')
  expect(wrapper.find('.structure-popover__option--active').exists()).toBe(false)
  expect(wrapper.find('.structure-popover__smiles').text()).toBe('乙醇 · CCO')
  await key(wrapper, { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([['CCO']])
})

test('点击一个分子直接完成', async () => {
  const wrapper = await open('')
  await input(wrapper).setValue('乙醇')
  await wrapper.findAll('.structure-popover__option')[0].trigger('click')
  expect(wrapper.emitted('commit')).toEqual([['CCO']])
})

test('编辑已有结构式：没有修改时完成得到原文；无法识别的 SMILES 预览为红色原文；Esc 放弃', async () => {
  const wrapper = await open(' CCO')
  key(wrapper, { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([[' CCO']])

  const invalid = await open('C1CC(')
  expect(invalid.find('.structure-popover__preview').classes()).toContain('is-invalid')
  expect(invalid.find('.structure-popover__preview').text()).toBe('C1CC(')

  const cancelled = await open('CCO')
  await key(cancelled, { key: 'Escape' })
  expect(cancelled.emitted('cancel')).toHaveLength(1)
})
