import { afterEach, expect, test } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { Selection, TextSelection } from 'prosemirror-state'
import { undo, redo } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'
import ChapterEditor from './ChapterEditor.vue'

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function mountEditor(props: {
  chapterId: string
  content: string
  number?: string
  title?: string
  resolveImage?: (reference: string) => string | null
}) {
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

/** 在正文末尾输入文字（与用户输入一样经过 dispatch）。 */
function type(view: EditorView, text: string): void {
  const end = Selection.atEnd(view.state.doc).from
  view.dispatch(view.state.tr.insertText(text, end))
}

function scroller(wrapper: VueWrapper): HTMLElement {
  return wrapper.find('.chapter-editor__scroller').element as HTMLElement
}

test('显示章节编号与标题，正文按结构进入编辑器', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言**正文**', number: '2.1', title: '实验设计' })
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2.1实验设计')
  const view = viewOf(wrapper)
  expect(view.state.doc.textContent).toBe('引言正文')
  expect(view.dom.querySelector('strong')?.textContent).toBe('正文')
})

test('编辑时发出 change，携带章节 id 与 Markdown 正文', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言\n' })
  type(viewOf(wrapper), '，补充')
  expect(wrapper.emitted('change')).toEqual([['a', '引言，补充\n']])
})

test('只移动光标或改变选区不会发出 change', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言正文' })
  const view = viewOf(wrapper)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  expect(wrapper.emitted('change')).toBeUndefined()
})

test('载入与切换章节不会发出 change，未编辑的正文不被规范化', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '* 星号列表\n' })
  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  expect(viewOf(wrapper).state.doc.textContent).toBe('B')
  expect(wrapper.emitted('change')).toBeUndefined()
})

test('切换章节复用同一个 EditorView', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  const view = viewOf(wrapper)
  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  expect(viewOf(wrapper)).toBe(view)
})

test('父组件回传自己的修改时不会替换文档', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  const view = viewOf(wrapper)
  type(view, '1')
  const stateBefore = view.state
  await wrapper.setProps({ content: 'A1' })
  expect(view.state).toBe(stateBefore)
})

test('切换章节后编辑只写入当前章节', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  type(viewOf(wrapper), '1')
  await wrapper.setProps({ content: 'A1' })
  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  type(viewOf(wrapper), '2')
  expect(wrapper.emitted('change')).toEqual([
    ['a', 'A1'],
    ['b', 'B2'],
  ])
})

test('切换回章节后撤销历史仍然有效；撤销回原样时给出原文', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '* 原文\n' })
  type(viewOf(wrapper), '1')
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', '- 原文1\n'])
  await wrapper.setProps({ content: '- 原文1\n' })

  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  await wrapper.setProps({ chapterId: 'a', content: '- 原文1\n' })
  const view = viewOf(wrapper)
  expect(view.state.doc.textContent).toBe('原文1')
  expect(undo(view.state, view.dispatch)).toBe(true)
  expect(view.state.doc.textContent).toBe('原文')
  // 撤销回载入时的文档：写回载入时的原文，而不是重新序列化的 "- 原文"。
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', '* 原文\n'])
  expect(redo(view.state, view.dispatch)).toBe(true)
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', '- 原文1\n'])
})

test('缓存状态与正文不一致时（如外部修改）以正文为准', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  await wrapper.setProps({ chapterId: 'a', content: '外部修改后的 A' })
  expect(viewOf(wrapper).state.doc.textContent).toBe('外部修改后的 A')
})

test('外部修改当前章节：替换文档（可撤销）且不回发 change', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  await wrapper.setProps({ content: '新内容' })
  const view = viewOf(wrapper)
  expect(view.state.doc.textContent).toBe('新内容')
  expect(wrapper.emitted('change')).toBeUndefined()
  // 替换后继续编辑，正文基于新内容。
  type(view, '！')
  expect(wrapper.emitted('change')).toEqual([['a', '新内容！']])
})

test('CRLF 正文编辑后仍是 CRLF', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '一\r\n\r\n二\r\n' })
  type(viewOf(wrapper), '三')
  expect(wrapper.emitted('change')).toEqual([['a', '一\r\n\r\n二三\r\n']])
})

test('工具栏按钮状态来自编辑器：光标在粗体中时粗体按钮按下', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '普通**粗体**' })
  const view = viewOf(wrapper)
  const bold = () => wrapper.find('button[aria-label="粗体"]')
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  await wrapper.vm.$nextTick()
  expect(bold().attributes('aria-pressed')).toBe('false')
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)))
  await wrapper.vm.$nextTick()
  expect(bold().attributes('aria-pressed')).toBe('true')
})

test('工具栏命令作用于选区并发出 change', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言' })
  const view = viewOf(wrapper)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
  await wrapper.find('button[aria-label="粗体"]').trigger('click')
  expect(wrapper.emitted('change')).toEqual([['a', '**引言**']])
  await wrapper.find('button[aria-label="引用"]').trigger('click')
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', '> **引言**'])
})

test('代码块中粗体按钮不可用', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '```\ncode\n```\n' })
  const view = viewOf(wrapper)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  await wrapper.vm.$nextTick()
  expect(wrapper.find('button[aria-label="粗体"]').attributes('disabled')).toBeDefined()
  expect(wrapper.find('button[aria-label="代码块"]').attributes('aria-pressed')).toBe('true')
})

test('插入图片：发起请求的章节仍是当前章节时插入，否则返回 false', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言' })
  const view = viewOf(wrapper)
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  await wrapper.find('button[aria-label="图片"]').trigger('click')
  expect(wrapper.emitted('request-image')).toEqual([['a']])
  const editor = wrapper.vm as unknown as { insertImage(id: string, ref: string, alt: string): boolean }
  expect(editor.insertImage('a', '../assets/图.png', '图')).toBe(true)
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', '引言\n\n![图](../assets/图.png)'])
  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  expect(editor.insertImage('a', '../assets/图2.png', '图2')).toBe(false)
})

test('图片按项目资源显示；无法解析的引用显示占位，引用不变', () => {
  const wrapper = mountEditor({
    chapterId: 'a',
    content: '![图](../assets/图.png)\n\n![远程](https://example.com/x.png)\n',
    resolveImage: (reference) => (reference.startsWith('../assets/') ? `asset://${reference.slice(10)}` : null),
  })
  const view = viewOf(wrapper)
  const image = view.dom.querySelector('.editor-image img')
  expect(image?.getAttribute('src')).toBe('asset://图.png')
  expect(view.dom.querySelector('.editor-image__missing')?.textContent).toContain('远程')
})

test('空章节显示占位提示，占位不进入正文', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '' })
  const view = viewOf(wrapper)
  expect(view.dom.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')).toBe('开始写作…')
  type(view, '第一')
  expect(view.dom.querySelector('[data-placeholder]')).toBeNull()
  expect(wrapper.emitted('change')).toEqual([['a', '第一\n']])
})

test('切换到没有打开过的章节时从顶部开始，回到章节时恢复离开时的位置', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '很长的正文\n\n'.repeat(200) })
  scroller(wrapper).scrollTop = 500
  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  expect(scroller(wrapper).scrollTop).toBe(0)
  await wrapper.setProps({ chapterId: 'a', content: '很长的正文\n\n'.repeat(200) })
  expect(scroller(wrapper).scrollTop).toBe(500)
})

test('卸载时销毁 EditorView', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  const view = viewOf(wrapper)
  wrapper.unmount()
  mounted.splice(mounted.indexOf(wrapper), 1)
  expect(view.isDestroyed).toBe(true)
})
