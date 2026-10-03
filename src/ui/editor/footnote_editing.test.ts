import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NodeSelection, Selection } from 'prosemirror-state'
import { undo } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'
import ChapterEditor from './ChapterEditor.vue'
import { renderChapterBody } from '../reader/chapter_body.ts'
import { NO_CHAPTER_REFS } from './chapter_ref_view.ts'

/** 编辑器中的脚注：编号、章末列表、插入与编辑。 */

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function mountEditor(content: string) {
  const wrapper = mount(ChapterEditor, {
    attachTo: document.body,
    props: { chapterId: 'a', content, number: '1', title: '绪论' },
  })
  mounted.push(wrapper)
  const view = (wrapper.vm as unknown as { getView(): EditorView }).getView()
  return { wrapper, view }
}

function lastChange(wrapper: VueWrapper): string | undefined {
  return (wrapper.emitted('change') as Array<[string, string]> | undefined)?.at(-1)?.[1]
}

const popover = () => document.querySelector<HTMLTextAreaElement>('.text-popover__input')

async function press(target: Element, key: string): Promise<void> {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  await flushPromises()
}

test('正文中按顺序编号，章节末尾列出脚注内容；载入不产生修改', () => {
  const { wrapper, view } = mountEditor('甲[^x]乙[^y]。\n\n[^x]: 第一条\n\n[^y]: 第二条\n')
  const refs = [...view.dom.querySelectorAll('.footnote-ref')]
  expect(refs.map((ref) => ref.getAttribute('data-number'))).toEqual(['1', '2'])
  expect(refs[0].getAttribute('title')).toBe('第一条')
  expect([...view.dom.querySelectorAll('.document-footnotes li')].map((li) => li.textContent)).toEqual(['第一条', '第二条'])
  expect(wrapper.emitted('change')).toBeUndefined()
})

test('插入脚注：先填写内容，Enter 完成后插入在光标处；Esc 取消不留下脚注', async () => {
  const { wrapper, view } = mountEditor('正文')
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  ;(wrapper.vm as unknown as { runCommand(c: string): void }).runCommand('footnote')
  await flushPromises()
  expect(popover()).not.toBeNull()
  expect(document.querySelector('.text-popover__label')?.textContent).toBe('脚注 1')
  await press(popover()!, 'Escape')
  expect(popover()).toBeNull()
  expect(wrapper.emitted('change')).toBeUndefined()

  ;(wrapper.vm as unknown as { runCommand(c: string): void }).runCommand('footnote')
  await flushPromises()
  popover()!.value = '参见\n原始文献'
  popover()!.dispatchEvent(new Event('input'))
  await press(popover()!, 'Enter')
  expect(lastChange(wrapper)).toBe('正文[^1]\n\n[^1]: 参见 原始文献')
  // 光标在脚注之后，可以接着输入。
  view.dispatch(view.state.tr.insertText('。'))
  expect(lastChange(wrapper)).toBe('正文[^1]。\n\n[^1]: 参见 原始文献')
})

test('双击脚注或单击章末列表编辑；清空内容即删除；修改可以撤销', async () => {
  const { wrapper, view } = mountEditor('甲[^1]乙\n\n[^1]: 旧内容\n')
  const ref = view.dom.querySelector('.footnote-ref')!
  ref.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  await flushPromises()
  expect(popover()!.value).toBe('旧内容')
  popover()!.value = '新内容'
  popover()!.dispatchEvent(new Event('input'))
  await press(popover()!, 'Enter')
  expect(lastChange(wrapper)).toBe('甲[^1]乙\n\n[^1]: 新内容\n')
  undo(view.state, view.dispatch)
  expect(lastChange(wrapper)).toBe('甲[^1]乙\n\n[^1]: 旧内容\n')

  view.dom.querySelector('.document-footnotes li')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  await flushPromises()
  popover()!.value = ''
  popover()!.dispatchEvent(new Event('input'))
  await press(popover()!, 'Enter')
  expect(lastChange(wrapper)).toBe('甲乙\n')
})

test('选中脚注时按 Enter 编辑', async () => {
  const { view } = mountEditor('甲[^1]\n\n[^1]: 内容\n')
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 2)))
  await press(view.dom, 'Enter')
  expect(popover()!.value).toBe('内容')
})

test('全文阅读：同样编号并在章节末尾列出', () => {
  const fragment = renderChapterBody('甲[^1]\n\n[^1]: 内容\n', () => null, NO_CHAPTER_REFS)
  const host = document.createElement('div')
  host.append(fragment)
  expect(host.querySelector('.footnote-ref')?.getAttribute('data-number')).toBe('1')
  expect(host.querySelector('.document-footnotes')?.textContent).toBe('内容')
})
