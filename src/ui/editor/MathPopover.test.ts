import { afterEach, describe, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import MathPopover from './MathPopover.vue'

/** 公式编辑浮层：可视编辑、常用结构、LaTeX 源码（docs/decisions.md 第 14 节）。 */

// happy-dom 没有 document.fonts，MathLive 的可视编辑器需要它。
Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true })

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

async function open(tex: string, display = false) {
  const wrapper = mount(MathPopover, { attachTo: document.body, props: { anchor: { x: 100, y: 100 }, label: '行内公式', tex, display } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

type Field = HTMLElement & { value: string; mode: string; executeCommand(command: string): boolean }
const field = (wrapper: VueWrapper) => wrapper.find('math-field').element as Field
const key = (target: Element, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init }))
const tool = (wrapper: VueWrapper, label: string) => wrapper.find(`.math-popover__tool[aria-label="${label}"]`)

test('默认是可视编辑；没有修改时完成得到原文，不按可视编辑器的风格改写', async () => {
  const wrapper = await open('\\frac ab')
  expect(field(wrapper).value).not.toBe('')
  expect(wrapper.find('.math-popover__input').exists()).toBe(false)
  key(field(wrapper), { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([['\\frac ab']])
})

test('常用结构插入带空位的写法，空位不写进公式', async () => {
  const wrapper = await open('')
  await tool(wrapper, '分数').trigger('click')
  await tool(wrapper, '根号').trigger('click')
  key(field(wrapper), { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([['\\frac{\\sqrt{}}{}']])
})

test('写出 KaTeX 与导出都能识别的 LaTeX：展开可视编辑器自己的命令，未填写次数的根号是普通根号', async () => {
  const wrapper = await open('')
  await tool(wrapper, 'n 次根号').trigger('click')
  key(field(wrapper), { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([['\\sqrt{}']])

  const other = await open('')
  field(other).value = '\\differentialD x+\\exponentialE'
  field(other).dispatchEvent(new Event('input'))
  key(field(other), { key: 'Enter' })
  expect(other.emitted('commit')).toEqual([['\\mathrm{d}x+\\mathrm{e}']])
})

test('符号面板默认收起，打开后插入符号', async () => {
  const wrapper = await open('x')
  expect(wrapper.find('.math-popover__symbols').exists()).toBe(false)
  await wrapper.find('.math-popover__tool--text').trigger('click')
  field(wrapper).executeCommand('moveToMathfieldEnd')
  await wrapper.find('.math-popover__tool[aria-label="\\\\le"]').trigger('click')
  key(field(wrapper), { key: 'Enter' })
  expect(wrapper.emitted('commit')).toEqual([['x\\le']])
})

test('Esc 放弃；正在输入 LaTeX 命令时 Enter 与 Esc 交给可视编辑器', async () => {
  const wrapper = await open('x')
  Object.defineProperty(field(wrapper), 'mode', { value: 'latex', configurable: true })
  key(field(wrapper), { key: 'Enter' })
  key(field(wrapper), { key: 'Escape' })
  expect(wrapper.emitted('commit')).toBeUndefined()
  expect(wrapper.emitted('cancel')).toBeUndefined()

  Object.defineProperty(field(wrapper), 'mode', { value: 'math', configurable: true })
  key(field(wrapper), { key: 'Escape' })
  expect(wrapper.emitted('cancel')).toHaveLength(1)
})

test('切换到 LaTeX 源码：文本框与预览，⇧Enter 换行；下次打开仍是源码，切回后同步修改', async () => {
  const wrapper = await open('x')
  await wrapper.find('.math-popover__mode').trigger('click')
  const input = wrapper.find('.math-popover__input')
  expect((input.element as HTMLTextAreaElement).value).toBe('x')
  expect(wrapper.find('.math-popover__tools').isVisible()).toBe(false)
  await input.setValue('a \\\\\nb')
  expect(wrapper.find('.math-popover__preview .katex').exists()).toBe(true)
  key(input.element, { key: 'Enter', shiftKey: true })
  expect(wrapper.emitted('commit')).toBeUndefined()

  const again = await open('y')
  expect(again.find('.math-popover__input').exists()).toBe(true)
  await again.find('.math-popover__input').setValue('z')
  await again.find('.math-popover__mode').trigger('click')
  expect(again.find('.math-popover__input').exists()).toBe(false)
  expect(field(again).value).toBe('z')
  key(field(again), { key: 'Enter' })
  expect(again.emitted('commit')).toEqual([['z']])
})

test('点击“完成”与“取消”与按 Enter / Esc 相同', async () => {
  const wrapper = await open('x')
  field(wrapper).value = 'y'
  field(wrapper).dispatchEvent(new Event('input'))
  await wrapper.find('.math-popover__action.is-default').trigger('click')
  expect(wrapper.emitted('commit')).toEqual([['y']])

  const other = await open('x')
  await other.findAll('.math-popover__action')[0].trigger('click')
  expect(other.emitted('cancel')).toHaveLength(1)
  expect(other.emitted('commit')).toBeUndefined()
})

describe('化学式（docs/decisions.md 第 22 节）', () => {
  async function openChem(tex: string) {
    const wrapper = mount(MathPopover, {
      attachTo: document.body,
      props: { anchor: { x: 100, y: 100 }, label: '行内化学式', tex, display: false, chem: true },
    })
    mounted.push(wrapper)
    await flushPromises()
    return wrapper
  }
  const input = (wrapper: VueWrapper) => wrapper.find('.math-popover__input').element as HTMLTextAreaElement

  test('直接编辑 \\ce{…} 的内容，没有可视编辑与 LaTeX 切换；预览显示排好的化学式', async () => {
    const wrapper = await openChem('\\ce{H2O}')
    expect(wrapper.find('math-field').exists()).toBe(false)
    expect(wrapper.find('.math-popover__mode').exists()).toBe(false)
    expect(input(wrapper).value).toBe('H2O')
    expect(wrapper.find('.math-popover__preview .katex').exists()).toBe(true)
    await wrapper.find('.math-popover__input').setValue('2H2 + O2 -> 2H2O')
    key(input(wrapper), { key: 'Enter' })
    expect(wrapper.emitted('commit')).toEqual([['\\ce{2H2 + O2 -> 2H2O}']])
  })

  test('没有修改时完成得到原文；清空后完成得到空公式；Esc 放弃', async () => {
    const wrapper = await openChem('\\ce { H2O }')
    key(input(wrapper), { key: 'Enter' })
    expect(wrapper.emitted('commit')).toEqual([['\\ce { H2O }']])

    const cleared = await openChem('\\ce{H2O}')
    await cleared.find('.math-popover__input').setValue(' ')
    key(input(cleared), { key: 'Enter' })
    expect(cleared.emitted('commit')).toEqual([['']])

    const cancelled = await openChem('\\ce{H2O}')
    key(input(cancelled), { key: 'Escape' })
    expect(cancelled.emitted('cancel')).toHaveLength(1)
  })

  test('常用写法插入在光标处，两侧的空格不重复；带条件的写法选中待填写的文字', async () => {
    const wrapper = await openChem('')
    await wrapper.find('.math-popover__input').setValue('2H2 + O2')
    input(wrapper).setSelectionRange(8, 8)
    await tool(wrapper, '反应条件（->[上方][下方]）').trigger('click')
    await flushPromises()
    expect(input(wrapper).value).toBe('2H2 + O2 ->[条件] ')
    expect(input(wrapper).value.slice(input(wrapper).selectionStart, input(wrapper).selectionEnd)).toBe('条件')
    await tool(wrapper, '加热').trigger('click')
    await flushPromises()
    expect(input(wrapper).value).toBe('2H2 + O2 ->[\\Delta] ')

    input(wrapper).setSelectionRange(input(wrapper).value.length, input(wrapper).value.length)
    await wrapper.find('.math-popover__input').setValue('2H2 + O2 ->[\\Delta] 2H2O')
    await tool(wrapper, '气体').trigger('click')
    await flushPromises()
    expect(input(wrapper).value).toBe('2H2 + O2 ->[\\Delta] 2H2O ^ ')
    key(input(wrapper), { key: 'Enter' })
    expect(wrapper.emitted('commit')).toEqual([['\\ce{2H2 + O2 ->[\\Delta] 2H2O ^}']])
  })
})
