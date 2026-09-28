import { afterEach, expect, test } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import ChapterEditor from './ChapterEditor.vue'

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function mountEditor(props: { chapterId: string; content: string; number?: string; title?: string }) {
  const wrapper = mount(ChapterEditor, {
    attachTo: document.body,
    props: { number: '1', title: '绪论', ...props },
  })
  mounted.push(wrapper)
  return wrapper
}

function viewOf(wrapper: VueWrapper): EditorView {
  const view = (wrapper.vm as unknown as { getView(): EditorView | null }).getView()
  if (!view) throw new Error('editor not mounted')
  return view
}

function type(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: view.state.doc.length, insert: text } })
}

test('显示章节编号与标题，正文进入编辑器', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言正文', number: '2.1', title: '实验设计' })
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2.1实验设计')
  expect(viewOf(wrapper).state.doc.toString()).toBe('引言正文')
})

test('编辑时发出 change，携带章节 id 与完整正文', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言' })
  type(viewOf(wrapper), '，补充')
  expect(wrapper.emitted('change')).toEqual([['a', '引言，补充']])
})

test('载入与切换章节不会发出 change', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  expect(viewOf(wrapper).state.doc.toString()).toBe('B')
  expect(wrapper.emitted('change')).toBeUndefined()
})

test('父组件回传自己的修改时不会重复替换正文', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  const view = viewOf(wrapper)
  type(view, '1')
  const stateBefore = view.state
  await wrapper.setProps({ content: 'A1' })
  expect(view.state).toBe(stateBefore)
})

test('切换回章节后撤销历史仍然有效', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  type(viewOf(wrapper), '1')
  await wrapper.setProps({ content: 'A1' })

  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  await wrapper.setProps({ chapterId: 'a', content: 'A1' })
  const view = viewOf(wrapper)
  expect(view.state.doc.toString()).toBe('A1')
  undo(view)
  expect(view.state.doc.toString()).toBe('A')
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', 'A'])
})

test('缓存状态与正文不一致时（如外部修改）以正文为准', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  await wrapper.setProps({ chapterId: 'a', content: '外部修改后的 A' })
  expect(viewOf(wrapper).state.doc.toString()).toBe('外部修改后的 A')
})

test('外部修改当前章节：替换正文且不回发 change', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  await wrapper.setProps({ content: '新内容' })
  expect(viewOf(wrapper).state.doc.toString()).toBe('新内容')
  expect(wrapper.emitted('change')).toBeUndefined()
})

test('CRLF 正文编辑后发出的仍是 CRLF', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '一\r\n二' })
  type(viewOf(wrapper), '三')
  expect(wrapper.emitted('change')).toEqual([['a', '一\r\n二三']])
})
