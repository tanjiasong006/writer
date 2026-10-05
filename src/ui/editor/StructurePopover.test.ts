import { afterEach, describe, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import StructurePopover from './StructurePopover.vue'

/** 化学结构式浮层：按名称查找、直接输入 SMILES、预览（docs/decisions.md 第 22 节）。 */

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

async function open(smiles: string, conditions: { arrow?: string; above?: string; below?: string } = {}) {
  const wrapper = mount(StructurePopover, { attachTo: document.body, props: { anchor: { x: 100, y: 100 }, smiles, ...conditions } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const input = (wrapper: VueWrapper) => wrapper.find('.structure-popover__search')
const key = (wrapper: VueWrapper, init: KeyboardEventInit) => input(wrapper).trigger('keydown', init)
const options = (wrapper: VueWrapper) => wrapper.findAll('.structure-popover__option').map((option) => option.find('.structure-popover__name').text())
const value = (smiles: string, arrow = '', above = '', below = '') => ({ smiles, arrow, above, below })
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
  expect(wrapper.emitted('commit')).toEqual([[value('C1=CC=CC=C1')]])
})

test('输入有效的 SMILES 时默认使用它；↓ 才选择名称的匹配', async () => {
  const wrapper = await open('')
  await input(wrapper).setValue('CCO')
  expect(wrapper.find('.structure-popover__option--active').exists()).toBe(false)
  expect(wrapper.find('.structure-popover__smiles').text()).toBe('乙醇 · CCO')
  await key(wrapper, { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([[value('CCO')]])
})

test('点击一个分子直接完成', async () => {
  const wrapper = await open('')
  await input(wrapper).setValue('乙醇')
  await wrapper.findAll('.structure-popover__option')[0].trigger('click')
  expect(wrapper.emitted('commit')).toEqual([[value('CCO')]])
})

test('编辑已有结构式：没有修改时完成得到原文；无法识别的 SMILES 预览为红色原文；Esc 放弃', async () => {
  const wrapper = await open(' CCO')
  key(wrapper, { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([[value(' CCO')]])

  const invalid = await open('C1CC(')
  expect(invalid.find('.structure-popover__preview').classes()).toContain('is-invalid')
  expect(invalid.find('.structure-popover__preview').text()).toBe('C1CC(')

  const cancelled = await open('CCO')
  await key(cancelled, { key: 'Escape' })
  expect(cancelled.emitted('cancel')).toHaveLength(1)
})

describe('反应式', () => {
  const field = (wrapper: VueWrapper, label: string) => wrapper.find(`input[aria-label="${label}"]`)
  const side = (wrapper: VueWrapper, index: number) => wrapper.findAll('.structure-popover__input')[index]

  test('打开已有的反应式：库中的分子显示名称，条件与箭头；未修改时得到原值', async () => {
    const wrapper = await open('CCO.CC(=O)O>>CCOC(C)=O.O', { arrow: '<=>', above: '浓硫酸' })
    expect(wrapper.find('[role="tab"][aria-selected="true"]').text()).toBe('反应式')
    expect((side(wrapper, 0).element as HTMLInputElement).value).toBe('乙醇 + 乙酸')
    expect((side(wrapper, 1).element as HTMLInputElement).value).toBe('乙酸乙酯 + 水')
    expect(wrapper.find('[role="radio"][aria-checked="true"]').attributes('aria-label')).toBe('可逆')
    expect((field(wrapper, '上方条件').element as HTMLInputElement).value).toBe('浓硫酸')
    expect(wrapper.find('.structure-popover__preview svg').exists()).toBe(true)
    await side(wrapper, 0).trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('commit')).toEqual([[{ smiles: 'CCO.CC(=O)O>>CCOC(C)=O.O', arrow: '<=>', above: '浓硫酸', below: '' }]])
  })

  test('写名称或 SMILES 组成反应式，选择箭头、填写条件；试剂保留', async () => {
    const wrapper = await open('CCO>OS(=O)(=O)O>C=C.O')
    await side(wrapper, 0).setValue('乙醇')
    await side(wrapper, 1).setValue('乙烯 + O')
    await wrapper.findAll('[role="radio"]')[2].trigger('click')
    await field(wrapper, '上方条件').setValue(' 浓硫酸 ')
    await field(wrapper, '下方条件').setValue('170 ℃')
    await field(wrapper, '下方条件').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('commit')).toEqual([[{ smiles: 'CCO>OS(=O)(=O)O>C=C.O', arrow: '=', above: '浓硫酸', below: '170 ℃' }]])
  })

  test('正在输入的名称下方列出匹配，Enter 填入而不完成；不认识的名称在预览中说明', async () => {
    const wrapper = await open('')
    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await side(wrapper, 0).trigger('focus')
    await side(wrapper, 0).setValue('乙醇 + 乙')
    expect(wrapper.find('.structure-popover__preview').text()).toContain('不认识：乙')
    const names = wrapper.findAll('.structure-popover__suggestions .structure-popover__name').map((name) => name.text())
    expect(names.length).toBeGreaterThan(1)
    await side(wrapper, 0).trigger('keydown', { key: 'ArrowDown' })
    await side(wrapper, 0).trigger('keydown', { key: 'Enter' })
    expect((side(wrapper, 0).element as HTMLInputElement).value).toBe(`乙醇 + ${names[1]}`)
    expect(wrapper.find('.structure-popover__suggestions').exists()).toBe(false)
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  test('从分子切换到反应式时，已输入的分子作为第一个反应物', async () => {
    const wrapper = await open('CCO')
    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    expect((side(wrapper, 0).element as HTMLInputElement).value).toBe('乙醇')
  })
})

