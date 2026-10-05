import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NodeSelection, Selection } from 'prosemirror-state'
import { undo } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'
import ChapterEditor from './ChapterEditor.vue'
import { renderChapterBody } from '../reader/chapter_body.ts'
import { NO_CHAPTER_REFS } from './chapter_ref_view.ts'

/** 编辑器中的公式：KaTeX 显示、插入、编辑、输入规则（docs/decisions.md 第 14 节）。 */

// happy-dom 没有 document.fonts，MathLive 的可视编辑器需要它。
Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true })

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function mountEditor(content: string) {
  const wrapper = mount(ChapterEditor, { attachTo: document.body, props: { chapterId: 'a', content, number: '1', title: '绪论' } })
  mounted.push(wrapper)
  const view = (wrapper.vm as unknown as { getView(): EditorView }).getView()
  return { wrapper, view }
}

const lastChange = (wrapper: VueWrapper) => (wrapper.emitted('change') as Array<[string, string]> | undefined)?.at(-1)?.[1]
const field = () => document.querySelector('.math-popover math-field') as (HTMLElement & { value: string }) | null

/** 在可视编辑器中把公式改为 tex，按 Enter 完成。 */
async function type(tex: string) {
  field()!.value = tex
  field()!.dispatchEvent(new Event('input'))
  await flushPromises()
  field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }))
  await flushPromises()
}

test('公式用 KaTeX 显示；无法识别的写法以红色原文显示；载入不产生修改', () => {
  const { wrapper, view } = mountEditor('设 $x^2$ 与 $\\badcommand$。\n\n$$\\frac{a}{b}$$\n')
  const [ok, bad] = [...view.dom.querySelectorAll('.math-inline')]
  expect(ok.querySelector('.katex')).not.toBeNull()
  expect(bad.classList.contains('is-invalid')).toBe(true)
  expect(view.dom.querySelector('.math-block .katex-display')).not.toBeNull()
  expect(wrapper.emitted('change')).toBeUndefined()
})

test('插入行内公式与公式块：先在可视编辑器中填写，Enter 完成后插入；取消不插入', async () => {
  const { wrapper, view } = mountEditor('正文')
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  const run = (command: string) => (wrapper.vm as unknown as { runCommand(c: string): void }).runCommand(command)
  run('math')
  await flushPromises()
  field()!.value = 'a+b'
  field()!.dispatchEvent(new Event('input'))
  field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
  await flushPromises()
  expect(field()).toBeNull()
  expect(wrapper.emitted('change')).toBeUndefined()

  run('math')
  await flushPromises()
  await type('a+b')
  expect(lastChange(wrapper)).toBe('正文$a+b$')
  run('math-block')
  await flushPromises()
  await type('\\sum_i x_i')
  // 可视编辑器按自己的风格写出编辑过的公式。
  expect(lastChange(wrapper)).toBe('正文$a+b$\n\n$$\\sum_{i}x_{i}$$')
})

test('双击或选中后按 Enter 编辑；清空即删除；可以撤销', async () => {
  const { wrapper, view } = mountEditor('设 $x$ 成立\n')
  view.dom.querySelector('.math-inline')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  await flushPromises()
  expect(field()!.value).toBe('x')
  await type('y')
  expect(lastChange(wrapper)).toBe('设 $y$ 成立\n')
  undo(view.state, view.dispatch)
  expect(lastChange(wrapper)).toBe('设 $x$ 成立\n')

  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 3)))
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await flushPromises()
  await type('')
  expect(lastChange(wrapper)).toBe('设  成立\n')
})

test('输入 $…$ 变成行内公式；价格这样的 $ 不转换', () => {
  const { wrapper, view } = mountEditor('')
  const input = (text: string) => {
    for (const char of text) {
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', (f) => f(view, from, to, char, () => view.state.tr.insertText(char, from, to)))
      if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
    }
  }
  input('面积 $\\pi r^2$')
  expect(lastChange(wrapper)).toBe('面积 $\\pi r^2$\n')
  expect(view.dom.querySelector('.math-inline')).not.toBeNull()
  input('，价格 $5 与 $')
  expect(view.dom.querySelectorAll('.math-inline')).toHaveLength(1)
})

test('全文阅读中同样显示公式', () => {
  const host = document.createElement('div')
  host.append(renderChapterBody('$x$\n\n$$y$$', () => null, NO_CHAPTER_REFS))
  expect(host.querySelector('.math-inline .katex')).not.toBeNull()
  expect(host.querySelector('.math-block .katex-display')).not.toBeNull()
})
