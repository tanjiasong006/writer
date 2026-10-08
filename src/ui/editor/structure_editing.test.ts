import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NodeSelection, Selection } from 'prosemirror-state'
import { undo } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'
import ChapterEditor from './ChapterEditor.vue'
import { renderChapterBody } from '../reader/chapter_body.ts'
import { NO_CHAPTER_REFS } from './chapter_ref_view.ts'
import { loadExtendedMolecules } from './structure_library.ts'

/** 编辑器中的化学结构式：显示、插入、编辑、删除、撤销（docs/decisions.md 第 22 节）。 */

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function mountEditor(content: string, otherStructures?: () => readonly string[]) {
  const wrapper = mount(ChapterEditor, { attachTo: document.body, props: { chapterId: 'a', content, number: '1', title: '绪论', otherStructures } })
  mounted.push(wrapper)
  const view = (wrapper.vm as unknown as { getView(): EditorView }).getView()
  return { wrapper, view }
}

const lastChange = (wrapper: VueWrapper) => (wrapper.emitted('change') as Array<[string, string]> | undefined)?.at(-1)?.[1]
const search = () => document.querySelector('.structure-popover__search') as HTMLInputElement | null

/** 在浮层中输入 text，按 Enter 完成。 */
async function type(text: string) {
  search()!.value = text
  search()!.dispatchEvent(new Event('input'))
  await flushPromises()
  search()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
}

test('结构式画成骨架式；无法识别的以红色原文显示；载入不产生修改', () => {
  const { wrapper, view } = mountEditor('```smiles\nCCO\n```\n\n```smiles\nC1CC(\n```\n')
  const [ok, bad] = view.dom.querySelectorAll('.structure-block')
  expect(ok.querySelector('svg')).not.toBeNull()
  expect(bad.classList.contains('is-invalid')).toBe(true)
  expect(bad.textContent).toBe('C1CC(')
  expect(wrapper.emitted('change')).toBeUndefined()
})

test('插入：先在浮层中按名称选择，Enter 完成后插入；取消不插入', async () => {
  const { wrapper, view } = mountEditor('正文')
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  const run = (command: string) => (wrapper.vm as unknown as { runCommand(c: string): void }).runCommand(command)
  run('structure')
  await flushPromises()
  search()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flushPromises()
  expect(search()).toBeNull()
  expect(wrapper.emitted('change')).toBeUndefined()

  run('structure')
  await flushPromises()
  await type('乙醇')
  expect(lastChange(wrapper)).toBe('正文\n\n```smiles\nCCO\n```')
})

test('双击或选中后按 Enter 编辑；清空即删除；可以撤销', async () => {
  const { wrapper, view } = mountEditor('前\n\n```smiles\nCCO\n```\n\n后\n')
  view.dom.querySelector('.structure-block')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  await flushPromises()
  expect(search()!.value).toBe('CCO')
  await type('CC=O')
  expect(lastChange(wrapper)).toBe('前\n\n```smiles\nCC=O\n```\n\n后\n')
  undo(view.state, view.dispatch)
  expect(lastChange(wrapper)).toBe('前\n\n```smiles\nCCO\n```\n\n后\n')

  let pos = -1
  view.state.doc.descendants((node, at) => {
    if (node.type.name === 'structure') pos = at
  })
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
  expect(search()).not.toBeNull()
  await type('')
  expect(lastChange(wrapper)).toBe('前\n\n后\n')
})

test('全文阅读中同样画出结构式', () => {
  const fragment = renderChapterBody('```smiles\nCCO\n```\n', () => null, NO_CHAPTER_REFS)
  expect(fragment.querySelector('.structure-block svg')).not.toBeNull()
})

test('插入反应式：写名称、选择箭头、填写条件，写出为带信息的 smiles 代码块', async () => {
  const { wrapper, view } = mountEditor('正文')
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  ;(wrapper.vm as unknown as { runCommand(c: string): void }).runCommand('structure')
  await flushPromises()
  ;(document.querySelectorAll('.structure-popover [role="tab"]')[1] as HTMLElement).click()
  await flushPromises()
  const inputs = document.querySelectorAll<HTMLInputElement>('.structure-popover__input')
  const set = (input: HTMLInputElement, value: string) => {
    input.value = value
    input.dispatchEvent(new Event('input'))
  }
  set(inputs[0], '氮气 + 氢气')
  set(inputs[1], '氨')
  ;(document.querySelector('.structure-popover [role="radio"][aria-label="可逆"]') as HTMLElement).click()
  set(document.querySelector<HTMLInputElement>('input[aria-label="上方条件"]')!, '催化剂')
  await flushPromises()
  inputs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
  expect(lastChange(wrapper)).toBe('正文\n\n```smiles arrow="<=>" above="催化剂"\nN#N.[H][H]>>N\n```')
  expect(view.dom.querySelector('.structure-block svg')).not.toBeNull()
})

test('插入时列出本文档中用过的分子：本章的在前，然后是其他章节的', async () => {
  await loadExtendedMolecules()
  const { wrapper, view } = mountEditor('```smiles\nClCCCCCCCCCCN\n```\n\n```smiles\nCCO>>C=C.O\n```\n', () => ['ClCCCCCCCCCCN', 'BrCCCCCCCCCCO'])
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  ;(wrapper.vm as unknown as { runCommand(c: string): void }).runCommand('structure')
  await flushPromises()
  const names = [...document.querySelectorAll('.structure-popover__option .structure-popover__name')].map((name) => name.textContent)
  expect(names).toEqual(['ClCCCCCCCCCCN', '乙醇', '乙烯', 'BrCCCCCCCCCCO'])
})
