import { afterEach, expect, test } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state'
import { undo, redo, undoDepth } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'
import ChapterEditor from './ChapterEditor.vue'
import {
  THEMES,
  defaultDocumentStyle,
  overrideStyle,
  resolveTheme,
  selectTheme,
  type DocumentTheme,
  type ImageLayouts,
} from '../../domain/document_style/document_style.ts'

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
  theme?: DocumentTheme
  imageLayouts?: ImageLayouts
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

test('点击工具栏不会让正文失去焦点与选区：按钮在 mousedown 时不抢焦点，命令之后可以直接继续输入', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言' })
  const view = viewOf(wrapper)
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
  const bold = wrapper.find('button[aria-label="粗体"]')
  const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  bold.element.dispatchEvent(mousedown)
  expect(mousedown.defaultPrevented).toBe(true)
  await bold.trigger('click')
  expect(view.hasFocus()).toBe(true)
  expect(view.state.selection.from).toBe(1)
  expect(view.state.selection.to).toBe(3)
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

test('从编辑器之外聚焦正文（章节树中按 Enter）：光标与滚动位置不变', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '很长的正文\n\n'.repeat(200) })
  const view = viewOf(wrapper)
  const cursor = TextSelection.create(view.state.doc, 300)
  view.dispatch(view.state.tr.setSelection(cursor))
  scroller(wrapper).scrollTop = 500
  // WebKit：焦点从别处移入时先把光标放到正文开头并滚动到顶部。
  const focus = view.focus.bind(view)
  view.focus = () => {
    scroller(wrapper).scrollTop = 0
    focus()
  }
  ;(wrapper.vm as unknown as { focus(): void }).focus()
  expect(scroller(wrapper).scrollTop).toBe(500)
  expect(view.state.selection.eq(cursor)).toBe(true)
})

test('卸载时销毁 EditorView', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: 'A' })
  const view = viewOf(wrapper)
  wrapper.unmount()
  mounted.splice(mounted.indexOf(wrapper), 1)
  expect(view.isDestroyed).toBe(true)
})

function rootVar(wrapper: VueWrapper, name: string): string {
  return (wrapper.find('.chapter-editor').element as HTMLElement).style.getPropertyValue(name)
}

test('主题通过 CSS 变量作用在编辑器外层：正文字体、字号、行距', () => {
  const theme = resolveTheme(overrideStyle(defaultDocumentStyle(), { bodyFont: 'sans', bodySize: 10.5, lineHeight: 2 }))
  const wrapper = mountEditor({ chapterId: 'a', content: '正文', theme })
  expect(rootVar(wrapper, '--doc-body-size')).toBe('10.5pt')
  expect(rootVar(wrapper, '--doc-line-height')).toBe('2')
  expect(rootVar(wrapper, '--doc-body-font')).toContain('Arial')
})

test('标题样式按章节层级映射：第 2 级章节的 # 是第 3 级标题', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '# 小节', number: '2.1' })
  expect(rootVar(wrapper, '--heading-size')).toBe('var(--doc-h2-size)')
  expect(rootVar(wrapper, '--md-h1-size')).toBe('var(--doc-h3-size)')
  expect(rootVar(wrapper, '--md-h6-font')).toBe('var(--doc-h3-font)')
})

test('修改主题：不产生 change、不进入撤销历史、不重建视图，选区与文档不变', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言正文' })
  const view = viewOf(wrapper)
  type(view, '，补充')
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)))
  const { doc, selection } = view.state
  const depth = undoDepth(view.state)
  const changes = wrapper.emitted('change')!.length

  await wrapper.setProps({ theme: resolveTheme(selectTheme(defaultDocumentStyle(), 'technical')) })
  await wrapper.setProps({ theme: resolveTheme(overrideStyle(defaultDocumentStyle(), { bodySize: 14 })) })

  expect(viewOf(wrapper)).toBe(view)
  expect(view.state.doc).toBe(doc)
  expect(view.state.selection.eq(selection)).toBe(true)
  expect(undoDepth(view.state)).toBe(depth)
  expect(wrapper.emitted('change')!.length).toBe(changes)
  expect(rootVar(wrapper, '--doc-body-size')).toBe('14pt')
  // 撤销仍然只撤销文字编辑。
  undo(view.state, view.dispatch)
  expect(view.state.doc.textContent).toBe('引言正文')
})

function selectFirstImage(view: EditorView): void {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'figure') found = pos
  })
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, found)))
}

const IMAGE_CHAPTER = '说明\n\n![装置](../assets/装置.png)\n'

test('选中图片时显示布局按钮，当前布局按下；改变布局发出 image-layout 而不是 change', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: IMAGE_CHAPTER })
  const view = viewOf(wrapper)
  expect(wrapper.find('[aria-label="图片布局"]').exists()).toBe(false)
  selectFirstImage(view)
  await wrapper.vm.$nextTick()
  const controls = wrapper.find('[aria-label="图片布局"]')
  expect(controls.exists()).toBe(true)
  expect(controls.find('button[aria-pressed="true"]').text()).toBe('原始')

  await controls.findAll('button').find((b) => b.text() === '大')!.trigger('click')
  expect(wrapper.emitted('image-layout')).toEqual([['assets/装置.png', { size: 'large' }]])
  expect(wrapper.emitted('change')).toBeUndefined()
  expect(view.state.selection).toBeInstanceOf(NodeSelection)
  expect(view.dom.querySelector('.is-figure')?.getAttribute('data-image-size')).toBe('large')

  await wrapper.find('button[aria-label="靠右"]').trigger('click')
  expect(wrapper.emitted('image-layout')!.at(-1)).toEqual(['assets/装置.png', { size: 'large', align: 'right' }])

  // 上层写回布局（与编辑器已一致）：什么都不变。
  const state = view.state
  await wrapper.setProps({ imageLayouts: new Map([['assets/装置.png', { size: 'large', align: 'right' }]]) })
  expect(view.state).toBe(state)

  undo(view.state, view.dispatch)
  expect(wrapper.emitted('image-layout')!.at(-1)).toEqual(['assets/装置.png', { size: 'large' }])
  undo(view.state, view.dispatch)
  expect(wrapper.emitted('image-layout')!.at(-1)).toEqual(['assets/装置.png', null])
  expect(wrapper.emitted('change')).toBeUndefined()
})

test('图片默认布局来自主题；上层的布局变化同步到编辑器', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: IMAGE_CHAPTER, theme: THEMES.technical })
  const view = viewOf(wrapper)
  const figure = () => view.dom.querySelector('.is-figure')!
  expect(figure().getAttribute('data-image-size')).toBe('large')
  await wrapper.setProps({ imageLayouts: new Map([['assets/装置.png', { size: 'small', align: 'left' }]]) })
  expect(figure().getAttribute('data-image-size')).toBe('small')
  expect(figure().getAttribute('data-image-align')).toBe('left')
  expect(wrapper.emitted('image-layout')).toBeUndefined()
})

test('其他章节修改了同一图片文件的布局：切换回来时显示最新布局', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: IMAGE_CHAPTER })
  await wrapper.setProps({ chapterId: 'b', content: '![装置](../assets/装置.png)\n' })
  await wrapper.setProps({ imageLayouts: new Map([['assets/装置.png', { size: 'full' }]]) })
  await wrapper.setProps({ chapterId: 'a', content: IMAGE_CHAPTER })
  const view = viewOf(wrapper)
  expect(view.dom.querySelector('.is-figure')?.getAttribute('data-image-size')).toBe('full')
  expect(wrapper.emitted('change')).toBeUndefined()
})
