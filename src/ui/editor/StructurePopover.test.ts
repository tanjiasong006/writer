import { afterEach, describe, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import StructurePopover from './StructurePopover.vue'
import { loadExtendedMolecules } from './structure_library.ts'

/** 化学结构式浮层：按名称查找、直接输入 SMILES、预览（docs/decisions.md 第 22 节）。 */

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

async function open(
  smiles: string,
  conditions: { arrow?: string; above?: string; below?: string; rotate?: number; flip?: boolean; used?: readonly string[] } = {},
) {
  // 扩展库先加载好，查找结果不随加载的快慢变化。
  await loadExtendedMolecules()
  const wrapper = mount(StructurePopover, { attachTo: document.body, props: { anchor: { x: 100, y: 100 }, smiles, ...conditions } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const input = (wrapper: VueWrapper) => wrapper.find('.structure-popover__search')
const key = (wrapper: VueWrapper, init: KeyboardEventInit) => input(wrapper).trigger('keydown', init)
const options = (wrapper: VueWrapper) => wrapper.findAll('.structure-popover__option').map((option) => option.find('.structure-popover__name').text())
const value = (smiles: string, arrow = '', above = '', below = '') => ({ smiles, arrow, above, below, rotate: 0, flip: false })
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

test('输入法打出的全角符号当作半角', async () => {
  const wrapper = await open('')
  await input(wrapper).setValue('CC（＝O）O')
  expect(wrapper.find('.structure-popover__smiles').text()).toBe('乙酸 · CC(=O)O')
  await key(wrapper, { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([[value('CC(=O)O')]])
})

test('没有输入时列出本文档中用过的分子，不默认选中；↓ 选择，库外的分子显示 SMILES', async () => {
  const wrapper = await open('', { used: ['ClCCCCCCCCCCN', 'CCO'] })
  expect(wrapper.find('.structure-popover__list-label').text()).toBe('本文档中')
  expect(options(wrapper)).toEqual(['ClCCCCCCCCCCN', '乙醇'])
  expect(wrapper.find('.structure-popover__option--active').exists()).toBe(false)
  await key(wrapper, { key: 'ArrowDown' })
  expect(active(wrapper).text()).toBe('ClCCCCCCCCCCN')
  expect(wrapper.find('.structure-popover__preview svg').exists()).toBe(true)
  await key(wrapper, { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([[value('ClCCCCCCCCCCN')]])

  // 输入后改为在库中查找；没有用过的分子时不列出。
  await input(wrapper).setValue('乙')
  expect(wrapper.find('.structure-popover__list-label').exists()).toBe(false)
  const empty = await open('')
  expect(empty.find('.structure-popover__list').exists()).toBe(false)
  await key(empty, { key: 'Enter' })
  expect(empty.emitted('commit')).toEqual([[value('')]])
})

test('无法画出时说明原因：SMILES 中标出出错的字符；不在库中的名称提示可以输入 SMILES', async () => {
  const wrapper = await open('')
  const preview = () => wrapper.find('.structure-popover__preview')
  await input(wrapper).setValue('CC(=O)Oq')
  expect(preview().find('mark').text()).toBe('q')
  expect(preview().text()).toContain('这里不能写“q”')
  await input(wrapper).setValue('CC(=O')
  expect(preview().text()).toContain('“(”没有对应的“)”')
  await input(wrapper).setValue('布洛芬片')
  expect(preview().text()).toBe('分子库中没有“布洛芬片”，也可以直接输入 SMILES')
  await input(wrapper).setValue('notamolecule')
  expect(preview().text()).toBe('分子库中没有“notamolecule”，也可以直接输入 SMILES')
  await input(wrapper).setValue('CCO')
  expect(preview().classes()).not.toContain('is-invalid')
  expect(preview().find('svg').exists()).toBe(true)
})

test('Tab 把选中的分子的 SMILES 填入输入框，在它的基础上修改', async () => {
  const wrapper = await open('')
  await input(wrapper).setValue('苯酚')
  expect(wrapper.find('.structure-popover__option--active .structure-popover__hint').exists()).toBe(true)
  await key(wrapper, { key: 'Tab' })
  expect((input(wrapper).element as HTMLInputElement).value).toBe('OC1=CC=CC=C1')
  expect(wrapper.find('.structure-popover__option--active').exists()).toBe(false)
  await input(wrapper).setValue('OC1=CC=C(Cl)C=C1')
  await key(wrapper, { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([[value('OC1=CC=C(Cl)C=C1')]])

  // 点击“编辑 SMILES”同样填入，不完成。
  const clicked = await open('')
  await input(clicked).setValue('苯酚')
  await clicked.find('.structure-popover__hint').trigger('click')
  expect((input(clicked).element as HTMLInputElement).value).toBe('OC1=CC=CC=C1')
  expect(clicked.emitted('commit')).toBeUndefined()

  // 没有选中的分子时 Tab 不做什么（不阻止默认行为）。
  const typed = await open('CCO')
  const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
  input(typed).element.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

test('分子可以旋转、翻转（翻转的是看到的样子）；反应式与写成化学式的分子没有这些按钮', async () => {
  const wrapper = await open('CCCCO')
  const button = (label: string) => wrapper.find(`.structure-popover__orient button[aria-label="${label}"]`)
  await button('向右旋转 30°').trigger('click')
  await button('向右旋转 30°').trigger('click')
  await button('向左旋转 30°').trigger('click')
  await key(wrapper, { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([[{ ...value('CCCCO'), rotate: 30 }]])

  const flipped = await open('CCCCO', { rotate: 30 })
  await flipped.find('.structure-popover__orient button[aria-label="左右翻转"]').trigger('click')
  await key(flipped, { key: 'Enter' })
  expect(flipped.emitted('commit')).toEqual([[{ ...value('CCCCO'), rotate: 330, flip: true }]])

  // 未修改时得到原值。
  const unchanged = await open('CCCCO', { rotate: 90, flip: true })
  await key(unchanged, { key: 'Enter' })
  expect(unchanged.emitted('commit')).toEqual([[{ ...value('CCCCO'), rotate: 90, flip: true }]])

  expect((await open('O')).find('.structure-popover__orient').exists()).toBe(false)
  expect((await open('C1CC(')).find('.structure-popover__orient').exists()).toBe(false)
  expect((await open('CCO>>C=C.O')).find('.structure-popover__orient').exists()).toBe(false)
})

test('版面不随输入跳动：插入时一开始就有列表的位置，编辑时第一次有匹配后出现，之后没有匹配也不收起', async () => {
  const inserting = await open('')
  expect(inserting.find('.structure-popover__results').exists()).toBe(true)
  expect(inserting.find('.structure-popover__empty').exists()).toBe(true)

  const editing = await open('CCO')
  expect(editing.find('.structure-popover__results').exists()).toBe(false)
  await input(editing).setValue('苯')
  expect(editing.find('.structure-popover__results').exists()).toBe(true)
  await input(editing).setValue('CCO')
  expect(editing.find('.structure-popover__list').exists()).toBe(false)
  expect(editing.find('.structure-popover__results').exists()).toBe(true)
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
  expect(invalid.find('.structure-popover__preview').text()).toBe('C1CC(“(”没有对应的“)”')
  expect(invalid.find('.structure-popover__preview mark').text()).toBe('(')

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
    expect(wrapper.emitted('commit')).toEqual([[value('CCO.CC(=O)O>>CCOC(C)=O.O', '<=>', '浓硫酸')]])
  })

  test('写名称或 SMILES 组成反应式，选择箭头、填写条件；试剂保留', async () => {
    const wrapper = await open('CCO>OS(=O)(=O)O>C=C.O')
    await side(wrapper, 0).setValue('乙醇')
    await side(wrapper, 1).setValue('乙烯 + O')
    await wrapper.findAll('[role="radio"]')[2].trigger('click')
    await field(wrapper, '上方条件').setValue(' 浓硫酸 ')
    await field(wrapper, '下方条件').setValue('170 ℃')
    await field(wrapper, '下方条件').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('commit')).toEqual([[value('CCO>OS(=O)(=O)O>C=C.O', '=', '浓硫酸', '170 ℃')]])
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

  test('反应式中写错的 SMILES 说明原因', async () => {
    const wrapper = await open('CCO>>C=C.O')
    await side(wrapper, 1).setValue('C=C + C(')
    expect(wrapper.find('.structure-popover__preview mark').text()).toBe('(')
    expect(wrapper.find('.structure-popover__preview').text()).toContain('“(”没有对应的“)”')
  })

  test('一侧为空或刚输入“+”时列出本文档中用过的分子，Enter 添在最后', async () => {
    const wrapper = await open('CCO>>C=C.O', { used: ['ClCCCCCCCCCCN'] })
    await side(wrapper, 0).trigger('focus')
    expect(wrapper.find('.structure-popover__suggestions').exists()).toBe(false)
    await side(wrapper, 0).setValue('乙醇 + ')
    expect(wrapper.findAll('.structure-popover__suggestions .structure-popover__name').map((name) => name.text())).toEqual(['ClCCCCCCCCCCN'])
    await side(wrapper, 0).trigger('keydown', { key: 'Enter' })
    expect((side(wrapper, 0).element as HTMLInputElement).value).toBe('乙醇 + ClCCCCCCCCCCN')
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  test('从分子切换到反应式时，已输入的分子作为第一个反应物', async () => {
    const wrapper = await open('CCO')
    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    expect((side(wrapper, 0).element as HTMLInputElement).value).toBe('乙醇')
  })
})

