import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state'
import { undo, redo, undoDepth } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'
import { CellSelection } from 'prosemirror-tables'
import ChapterEditor from './ChapterEditor.vue'
import { FONT_STACKS } from './editor_theme.ts'

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

type Tools = [import('./commands.ts').CommandState]

function lastTools(wrapper: VueWrapper): Tools[0] {
  const emitted = wrapper.emitted('tools') as Tools[] | undefined
  if (!emitted || emitted.length === 0) throw new Error('no tools emitted')
  return emitted.at(-1)![0]
}

function run(wrapper: VueWrapper, command: import('./commands.ts').EditorCommand): void {
  ;(wrapper.vm as unknown as { runCommand(command: string): void }).runCommand(command)
}

test('命令状态来自编辑器：光标在粗体中时粗体为激活，只在变化时发出', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '普通**粗体**' })
  const view = viewOf(wrapper)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  expect(lastTools(wrapper).bold.active).toBe(false)
  const count = wrapper.emitted('tools')!.length
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
  expect(wrapper.emitted('tools')!.length).toBe(count)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)))
  expect(lastTools(wrapper).bold.active).toBe(true)
})

test('runCommand 作用于选区并发出 change，焦点与选区留在正文中', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言' })
  const view = viewOf(wrapper)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
  run(wrapper, 'bold')
  expect(wrapper.emitted('change')).toEqual([['a', '**引言**']])
  expect(view.hasFocus()).toBe(true)
  expect(view.state.selection.from).toBe(1)
  expect(view.state.selection.to).toBe(3)
  run(wrapper, 'quote')
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', '> **引言**'])
})

test('代码块中粗体不可用，代码块为激活', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '```\ncode\n```\n' })
  const view = viewOf(wrapper)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  expect(lastTools(wrapper).bold.enabled).toBe(false)
  expect(lastTools(wrapper)['code-block'].active).toBe(true)
})

test('插入图片：发起请求的章节仍是当前章节时插入，否则返回 false', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '引言' })
  const view = viewOf(wrapper)
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  run(wrapper, 'image')
  expect(wrapper.emitted('request-image')).toEqual([['a']])
  const editor = wrapper.vm as unknown as { insertImage(id: string, ref: string, alt: string): boolean }
  expect(editor.insertImage('a', '../assets/图.png', '图')).toBe(true)
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', '引言\n\n![图](../assets/图.png)'])
  await wrapper.setProps({ chapterId: 'b', content: 'B' })
  expect(editor.insertImage('a', '../assets/图2.png', '图2')).toBe(false)
})

/** 没有系统菜单时右键菜单由界面绘制；按名称选择其中一项。 */
async function chooseFromContextMenu(wrapper: VueWrapper, label: string): Promise<void> {
  const item = wrapper
    .findAll('[role="menu"] button')
    .find((button) => button.find('.popup-menu__label').text() === label)
  if (!item) throw new Error(`menu item ${label} not found`)
  await item.trigger('click')
}

test('右键菜单：表格中列出行列操作，选择后作用于点击处', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n' })
  const view = viewOf(wrapper)
  view.posAtCoords = () => ({ pos: 12, inside: -1 })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)))
  await wrapper.find('.chapter-editor__mount').trigger('contextmenu')
  const labels = wrapper.findAll('[role="menu"] .popup-menu__label').map((label) => label.text())
  expect(labels.slice(0, 4)).toEqual(['在上方插入行', '在下方插入行', '在左侧插入列', '在右侧插入列'])
  expect(labels).not.toContain('插入表格')
  await chooseFromContextMenu(wrapper, '在下方插入行')
  expect(wrapper.emitted('change')!.at(-1)![1]).toBe('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n')
})

test('右键菜单：代码块中选择代码语言，写入围栏并显示角标', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '```\nx = 1\n```\n' })
  const view = viewOf(wrapper)
  view.posAtCoords = () => ({ pos: 2, inside: -1 })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  await wrapper.find('.chapter-editor__mount').trigger('contextmenu')
  await chooseFromContextMenu(wrapper, 'Python')
  expect(wrapper.emitted('change')!.at(-1)![1]).toBe('```python\nx = 1\n```\n')
  expect(view.dom.querySelector('pre')!.dataset.language).toBe('Python')
})

test('右键点在选中的任一单元格上时保留多个单元格的选区，删除行作用于全部选中的行', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n' })
  const view = viewOf(wrapper)
  const cellOf = (text: string) => {
    let found = -1
    view.state.doc.descendants((node, pos) => {
      if (found < 0 && node.type.spec.tableRole === 'cell' && node.textContent === text) found = pos
      return found < 0
    })
    return view.state.doc.resolve(found)
  }
  const selection = new CellSelection(cellOf('1'), cellOf('3'))
  for (const clicked of ['1', '3']) {
    view.dispatch(view.state.tr.setSelection(selection.map(view.state.doc, view.state.tr.mapping)))
    view.posAtCoords = () => ({ pos: cellOf(clicked).pos + 2, inside: -1 })
    await wrapper.find('.chapter-editor__mount').trigger('contextmenu')
    expect(view.state.selection, clicked).toBeInstanceOf(CellSelection)
  }
  await chooseFromContextMenu(wrapper, '删除行')
  expect(wrapper.emitted('change')!.at(-1)![1]).toBe('| 甲 | 乙 |\n| --- | --- |\n| 5 | 6 |\n')
})

test('Shift+F10 在光标处打开右键菜单，第一项获得焦点；插入的行可以直接输入', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n' })
  const view = viewOf(wrapper)
  view.coordsAtPos = () => ({ left: 10, right: 10, top: 0, bottom: 20 })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)))
  await wrapper.find('.chapter-editor__mount').trigger('keydown', { key: 'F10', shiftKey: true })
  const first = wrapper.find('[role="menu"] button')
  expect(first.find('.popup-menu__label').text()).toBe('在上方插入行')
  expect(document.activeElement).toBe(first.element)
  await chooseFromContextMenu(wrapper, '在下方插入行')
  view.dispatch(view.state.tr.insertText('新'))
  expect(wrapper.emitted('change')!.at(-1)![1]).toBe('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n| 新 |  |\n')
})

test('openMenuAtCaret（⌘/，由菜单栏调用）在光标处打开同一个菜单', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n' })
  const view = viewOf(wrapper)
  view.coordsAtPos = () => ({ left: 10, right: 10, top: 0, bottom: 20 })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)))
  void (wrapper.vm as unknown as { openMenuAtCaret(): Promise<void> }).openMenuAtCaret()
  await flushPromises()
  const first = wrapper.find('[role="menu"] button')
  expect(first.find('.popup-menu__label').text()).toBe('在上方插入行')
  expect(document.activeElement).toBe(first.element)
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

test('编辑环境的默认展示参数以 CSS 变量作用在编辑器外层，不来自项目数据', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '正文' })
  expect(rootVar(wrapper, '--doc-body-size')).toBe('17px')
  expect(rootVar(wrapper, '--doc-line-height')).toBe('1.78')
  expect(rootVar(wrapper, '--doc-body-font')).toBe(FONT_STACKS.serif)
})

test('章节标题样式按章节层级映射；正文中的 # 只是文字', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: '# 小节', number: '2.1' })
  expect(rootVar(wrapper, '--heading-size')).toBe('var(--doc-h2-size)')
  const view = viewOf(wrapper)
  expect(view.dom.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull()
  expect(view.state.doc.textContent).toBe('# 小节')
})

function selectFirstImage(view: EditorView): void {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'figure') found = pos
  })
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, found)))
}

const IMAGE_CHAPTER = '说明\n\n![装置](../assets/装置.png)\n'

test('图片没有单张的布局设置：选中后不出现布局按钮，figure 不带尺寸 / 对齐；删除可撤销', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: IMAGE_CHAPTER })
  const view = viewOf(wrapper)
  selectFirstImage(view)
  await wrapper.vm.$nextTick()
  expect(view.state.selection).toBeInstanceOf(NodeSelection)
  expect(wrapper.find('[aria-label="图片布局"]').exists()).toBe(false)
  const figure = view.dom.querySelector('.editor-figure')!
  expect(figure.getAttribute('data-image-size')).toBeNull()
  expect(figure.getAttribute('data-image-align')).toBeNull()
  expect(wrapper.emitted('image-layout')).toBeUndefined()

  view.dispatch(view.state.tr.deleteSelection())
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', '说明\n'])
  undo(view.state, view.dispatch)
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', IMAGE_CHAPTER])
})


function captionOf(view: EditorView): HTMLTextAreaElement {
  return view.dom.querySelector('.editor-figure__caption-input')!
}

function typeCaption(caption: HTMLTextAreaElement, value: string): void {
  caption.value = value
  caption.dispatchEvent(new Event('input', { bubbles: true }))
}

function pressIn(element: HTMLElement, key: string): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

test('图注：图片下方显示替代文字；没有图注时只有选中图片才显示“添加图注”', () => {
  const view = viewOf(mountEditor({ chapterId: 'a', content: '![装置](../assets/装置.png)\n\n![](../assets/空.png)\n' }))
  const [captioned, empty] = [...view.dom.querySelectorAll('.editor-figure')]
  expect((captioned.querySelector('textarea') as HTMLTextAreaElement).value).toBe('装置')
  expect(captioned.classList.contains('has-caption')).toBe(true)
  expect(empty.classList.contains('has-caption')).toBe(false)
  expect((empty.querySelector('textarea') as HTMLTextAreaElement).placeholder).toBe('添加图注')
  // 行内图片没有图注。
  const inline = viewOf(mountEditor({ chapterId: 'b', content: '文字![图](../assets/图.png)' }))
  expect(inline.dom.querySelector('textarea')).toBeNull()
})

test('图注：编辑后 Enter 写回替代文字并选中图片，可撤销；编辑中不产生 change', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: IMAGE_CHAPTER })
  const view = viewOf(wrapper)
  const caption = captionOf(view)
  caption.focus()
  typeCaption(caption, '  实验装置示意 ')
  expect(wrapper.emitted('change')).toBeUndefined()

  pressIn(caption, 'Enter')
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', '说明\n\n![实验装置示意](../assets/装置.png)\n'])
  expect(view.state.selection).toBeInstanceOf(NodeSelection)
  expect(view.hasFocus()).toBe(true)
  expect(caption.value).toBe('实验装置示意')

  undo(view.state, view.dispatch)
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', IMAGE_CHAPTER])
  expect(caption.value).toBe('装置')
})

test('图注：Esc 放弃本次修改；焦点离开时写回；换行替换为空格', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: IMAGE_CHAPTER })
  const view = viewOf(wrapper)
  const caption = captionOf(view)

  caption.focus()
  typeCaption(caption, '不要')
  pressIn(caption, 'Escape')
  expect(caption.value).toBe('装置')
  expect(wrapper.emitted('change')).toBeUndefined()
  expect(view.state.selection).toBeInstanceOf(NodeSelection)

  caption.focus()
  typeCaption(caption, '第一行\n第二行')
  expect(caption.value).toBe('第一行 第二行')
  caption.blur()
  expect(wrapper.emitted('change')!.at(-1)).toEqual(['a', '说明\n\n![第一行 第二行](../assets/装置.png)\n'])
})

test('图注：输入法组字中的 Enter 不结束编辑；文本框中的按键不交给正文', () => {
  const wrapper = mountEditor({ chapterId: 'a', content: IMAGE_CHAPTER })
  const view = viewOf(wrapper)
  const caption = captionOf(view)
  caption.focus()
  typeCaption(caption, '装置图')
  caption.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(caption)
  pressIn(caption, 'Backspace')
  expect(view.state.doc.textContent).toBe('说明')
  expect(wrapper.emitted('change')).toBeUndefined()
})

test('图注：选中图片后从右键菜单进入编辑（添加 / 编辑图注）', async () => {
  const wrapper = mountEditor({ chapterId: 'a', content: IMAGE_CHAPTER })
  const view = viewOf(wrapper)
  selectFirstImage(view)
  const editor = wrapper.vm as unknown as { openMenuAtCaret(): Promise<void> }
  void editor.openMenuAtCaret()
  await flushPromises()
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('编辑图注'))
  expect(item).toBeDefined()
  ;(item as HTMLElement).click()
  await flushPromises()
  expect(document.activeElement).toBe(captionOf(view))
})
