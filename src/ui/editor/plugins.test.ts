import { afterEach, expect, test } from 'vitest'
import { Selection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parseMarkdown, serializeChapter } from './markdown.ts'
import { createEditorState } from './plugins.ts'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

function viewOf(markdown: string): EditorView {
  const view = new EditorView(document.body.appendChild(document.createElement('div')), {
    state: createEditorState(parseMarkdown(markdown)),
  })
  views.push(view)
  return view
}

function cursorAfter(view: EditorView, needle: string): void {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle) + needle.length
  })
  if (found < 0) throw new Error(`"${needle}" not found`)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found)))
}

/** 与 prosemirror-keymap 相同的平台判断：Mod 在 macOS 上是 Cmd，其他平台是 Ctrl。 */
const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)

function press(view: EditorView, key: string, modifiers: { shift?: boolean; mod?: boolean } = {}): boolean {
  const mod = modifiers.mod ?? false
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey: modifiers.shift ?? false,
    metaKey: mac && mod,
    ctrlKey: !mac && mod,
  })
  return view.someProp('handleKeyDown', (handle) => handle(view, event)) ?? false
}

/** 模拟用户输入文字（经过输入规则）。 */
function typeText(view: EditorView, text: string): void {
  for (const char of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (handle) => handle(view, from, to, char, () => view.state.tr))
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
  }
}

function markdown(view: EditorView): string {
  return serializeChapter(view.state.doc)
}

test('Enter 分段；列表中 Enter 新建列表项，空列表项中 Enter 退出列表', () => {
  const view = viewOf('第一段')
  cursorAfter(view, '第一')
  press(view, 'Enter')
  expect(markdown(view)).toBe('第一\n\n段\n')

  const list = viewOf('- 甲')
  cursorAfter(list, '甲')
  press(list, 'Enter')
  typeText(list, '乙')
  expect(markdown(list)).toBe('- 甲\n- 乙\n')
  press(list, 'Enter')
  press(list, 'Enter')
  typeText(list, '正文')
  expect(markdown(list)).toBe('- 甲\n- 乙\n\n正文\n')
})

test('Shift+Enter 插入硬换行；代码块中 Enter 换行', () => {
  const view = viewOf('甲乙')
  cursorAfter(view, '甲')
  press(view, 'Enter', { shift: true })
  expect(markdown(view)).toBe('甲\\\n乙\n')

  const code = viewOf('```\na\n```')
  cursorAfter(code, 'a')
  press(code, 'Enter')
  typeText(code, 'b')
  expect(markdown(code)).toBe('```\na\nb\n```\n')
})

test('表格：Tab 移到下一个单元格（选中其内容），Enter 移到下方单元格，最后一行 Enter 新增一行', () => {
  const view = viewOf('| a | b |\n| --- | --- |\n| c | d |\n')
  cursorAfter(view, 'a')
  press(view, 'Tab')
  typeText(view, 'B')
  expect(markdown(view)).toContain('| a | B |')
  press(view, 'Enter')
  typeText(view, '1')
  expect(markdown(view)).toBe('| a | B |\n| --- | --- |\n| c | d1 |\n')
  press(view, 'Enter')
  typeText(view, '新行')
  expect(markdown(view)).toBe('| a | B |\n| --- | --- |\n| c | d1 |\n|  | 新行 |\n')
})

test('列表中 Tab / Shift+Tab 缩进与取消缩进', () => {
  const view = viewOf('- 甲\n- 乙\n')
  cursorAfter(view, '乙')
  press(view, 'Tab')
  expect(markdown(view)).toBe('- 甲\n  - 乙\n')
  press(view, 'Tab', { shift: true })
  expect(markdown(view)).toBe('- 甲\n- 乙\n')
})

test('Mod+Z 撤销，Mod+Shift+Z 重做', () => {
  const view = viewOf('引言')
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  typeText(view, '补充')
  expect(markdown(view)).toBe('引言补充\n')
  press(view, 'z', { mod: true })
  expect(markdown(view)).toBe('引言\n')
  press(view, 'z', { mod: true, shift: true })
  expect(markdown(view)).toBe('引言补充\n')
})

test('常见格式快捷键', () => {
  const view = viewOf('甲乙丙')
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 2)))
  press(view, 'b', { mod: true })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 3)))
  press(view, 'i', { mod: true })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 4)))
  press(view, 'e', { mod: true })
  expect(markdown(view)).toBe('**甲***乙*`丙`\n')
})

test('Markdown 输入规则：块结构', () => {
  const cases: Array<[string, string]> = [
    ['# 标题', '# 标题\n'],
    ['## 小节', '## 小节\n'],
    ['- 列表', '- 列表\n'],
    ['1. 有序', '1. 有序\n'],
    ['> 引用', '> 引用\n'],
    ['```', '```\n\n```\n'],
  ]
  for (const [input, expected] of cases) {
    const view = viewOf('')
    typeText(view, input)
    expect(markdown(view)).toBe(expected)
  }
  const rule = viewOf('')
  typeText(rule, '---')
  typeText(rule, '后文')
  expect(markdown(rule)).toBe('---\n\n后文\n')
})

test('输入规则可以用 Backspace 撤销', () => {
  const view = viewOf('')
  typeText(view, '- ')
  press(view, 'Backspace')
  expect(view.state.doc.firstChild!.type.name).toBe('paragraph')
  expect(view.state.doc.textContent).toBe('- ')
})

test('剪贴板：复制出 Markdown 文本，粘贴的纯文本按 Markdown 解析', () => {
  const view = viewOf('**粗体**与*斜体*\n\n- 列表\n')
  const serializer = view.someProp('clipboardTextSerializer')!
  expect(serializer(view.state.doc.slice(0, view.state.doc.content.size), view)).toBe('**粗体**与*斜体*\n\n- 列表')
  const parser = view.someProp('clipboardTextParser')!
  const slice = parser('## 标题\n\n| a |\n| - |\n| b |', view.state.doc.resolve(1), false, view)
  expect(slice.content.child(0).type.name).toBe('heading')
  expect(slice.content.child(1).type.name).toBe('table')
})

test('表格是章节的第一个 / 最后一个块时，方向键可以把光标移到表格之前 / 之后', async () => {
  const { GapCursor } = await import('prosemirror-gapcursor')
  const view = viewOf('| a | b |\n| --- | --- |\n| c | d |\n')
  // happy-dom 没有排版：光标所在的单元格只有一行，"已在文本块的首 / 末行"恒为真。
  view.endOfTextblock = () => true
  const tableSize = view.state.doc.child(0).nodeSize
  cursorAfter(view, 'd')
  press(view, 'ArrowDown')
  expect(view.state.selection).toBeInstanceOf(GapCursor)
  expect(view.state.selection.from).toBe(tableSize)
  typeText(view, '表格后')
  expect(markdown(view)).toBe('| a | b |\n| --- | --- |\n| c | d |\n\n表格后\n')

  cursorAfter(view, 'a')
  press(view, 'ArrowUp')
  expect(view.state.selection).toBeInstanceOf(GapCursor)
  expect(view.state.selection.from).toBe(0)
})

test('粘贴：单元格中的多段压成一行；只接受正文中的相对图片引用', () => {
  const view = viewOf('')
  const html =
    '<table><tr><td><p class="MsoNormal">第一段</p><p><b>第二段</b></p></td><td><p>乙</p></td></tr>' +
    '<tr><td><p>1</p></td><td><p>2</p></td></tr></table>' +
    '<p>图：<img src="../assets/a.png" alt="本地"><img src="https://example.com/x.png" alt="远程">' +
    '<img src="data:image/png;base64,AAAA" alt="内嵌"><img src="file:///tmp/clip.png" alt="临时"></p>'
  view.pasteHTML(html)
  expect(markdown(view)).toBe('| 第一段 **第二段** | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n图：![本地](../assets/a.png)\n')
})
