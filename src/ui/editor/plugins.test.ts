import { afterEach, expect, test } from 'vitest'
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state'
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

test('Mod+Z 撤销；重做没有快捷键（Mod+Shift+Z、Mod+Y 不再是正文的按键，重做在编辑菜单中）', () => {
  const view = viewOf('引言')
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  typeText(view, '补充')
  expect(markdown(view)).toBe('引言补充\n')
  press(view, 'z', { mod: true })
  expect(markdown(view)).toBe('引言\n')
  press(view, 'z', { mod: true, shift: true })
  press(view, 'y', { mod: true })
  expect(markdown(view)).toBe('引言\n')
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
    // 正文不支持标题：# 只是文字。
    ['# 标题', '\\# 标题\n'],
    ['## 小节', '\\## 小节\n'],
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
  expect(slice.content.child(0).type.name).toBe('paragraph')
  expect(slice.content.child(0).textContent).toBe('## 标题')
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

  // 不在最后一列时同样离开表格，而不是在同一行内横向移动。
  const other = viewOf('| a | b |\n| --- | --- |\n| c | d |\n')
  other.endOfTextblock = () => true
  cursorAfter(other, 'c')
  press(other, 'ArrowDown')
  expect(other.state.selection).toBeInstanceOf(GapCursor)
  expect(other.state.selection.from).toBe(tableSize)
  cursorAfter(other, 'b')
  press(other, 'ArrowUp')
  expect(other.state.selection).toBeInstanceOf(GapCursor)
  expect(other.state.selection.from).toBe(0)
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

test('Tab / Shift+Tab 永远由编辑器处理：普通段落、第一个列表项中什么也不做，焦点不会移出正文', () => {
  const view = viewOf('段落')
  cursorAfter(view, '段')
  expect(press(view, 'Tab')).toBe(true)
  expect(press(view, 'Tab', { shift: true })).toBe(true)
  expect(markdown(view)).toBe('段落\n')

  const list = viewOf('- 甲')
  cursorAfter(list, '甲')
  expect(press(list, 'Tab')).toBe(true)
  expect(markdown(list)).toBe('- 甲\n')
})

test('先按 Esc 再按 Tab / Shift+Tab：编辑器不处理，焦点按浏览器默认方式离开正文（列表中也一样）', () => {
  const view = viewOf('- 甲\n- 乙')
  cursorAfter(view, '乙')
  press(view, 'Escape')
  expect(press(view, 'Tab')).toBe(false)
  press(view, 'Escape')
  press(view, 'Shift')
  expect(press(view, 'Tab', { shift: true })).toBe(false)
  expect(markdown(view)).toBe('- 甲\n- 乙\n')
  // 其他按键之后 Tab 恢复为缩进。
  cursorAfter(view, '乙')
  press(view, 'Escape')
  press(view, 'ArrowLeft')
  expect(press(view, 'Tab')).toBe(true)
  expect(markdown(view)).toBe('- 甲\n  - 乙\n')
})

test('表格最后一个单元格中按 Tab：新增一行，光标进入新行的第一个单元格', () => {
  const view = viewOf('| a | b |\n| --- | --- |\n| c | d |\n')
  cursorAfter(view, 'd')
  press(view, 'Tab')
  typeText(view, '新')
  expect(markdown(view)).toBe('| a | b |\n| --- | --- |\n| c | d |\n| 新 |  |\n')
  press(view, 'z', { mod: true })
  expect(markdown(view)).toBe('| a | b |\n| --- | --- |\n| c | d |\n')
})

test('代码块：Tab 缩进两个空格，Shift+Tab 取消缩进；末尾连续两个空行后 Enter 离开代码块', () => {
  const view = viewOf('```\na\n```')
  cursorAfter(view, 'a')
  press(view, 'Enter')
  press(view, 'Tab')
  typeText(view, 'b')
  expect(markdown(view)).toBe('```\na\n  b\n```\n')
  press(view, 'Tab', { shift: true })
  expect(markdown(view)).toBe('```\na\nb\n```\n')

  press(view, 'Enter')
  press(view, 'Enter')
  expect(view.state.doc.firstChild!.textContent).toBe('a\nb\n\n')
  press(view, 'Enter')
  typeText(view, '正文')
  expect(markdown(view)).toBe('```\na\nb\n```\n\n正文\n')
})

test('代码块是章节的最后 / 第一个块时，↓ / ↑ 在其后 / 前新建段落；后面还有内容时照常移动', () => {
  const view = viewOf('```\ncode\n```')
  // happy-dom 没有排版：代码只有一行，"已在文本块的首 / 末行"恒为真。
  view.endOfTextblock = () => true
  cursorAfter(view, 'code')
  expect(press(view, 'ArrowDown')).toBe(true)
  typeText(view, '后')
  expect(markdown(view)).toBe('```\ncode\n```\n\n后\n')

  cursorAfter(view, 'co')
  press(view, 'ArrowUp')
  typeText(view, '前')
  expect(markdown(view)).toBe('前\n\n```\ncode\n```\n\n后\n')

  cursorAfter(view, 'code')
  press(view, 'ArrowDown')
  expect(view.state.doc.childCount).toBe(3)
})

test('刚由输入规则转换后按 Mod+Z：回到转换前的文字', () => {
  for (const input of ['- ', '1. ', '> ', '```']) {
    const view = viewOf('')
    typeText(view, input)
    press(view, 'z', { mod: true })
    expect(view.state.doc.firstChild!.type.name).toBe('paragraph')
    expect(view.state.doc.textContent).toBe(input)
  }
})

test('表头单元格末尾有不可编辑的空标记（WebKit 输入法确认时单元格不会变空），标记不进入正文', () => {
  const view = viewOf('| 名称 | |\n| --- | --- |\n| 甲 | 乙 |')
  const headers = [...view.dom.querySelectorAll('th')]
  expect(headers.map((cell) => cell.querySelectorAll('.editor-cell-end').length)).toEqual([1, 1])
  expect(view.dom.querySelectorAll('td .editor-cell-end')).toHaveLength(0)
  expect(headers[0].querySelector('.editor-cell-end')!.getAttribute('contenteditable')).toBe('false')

  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3 + '名称'.length)))
  typeText(view, '表')
  expect(headers[0].textContent).toBe('名称表')
  expect(markdown(view)).toBe('| 名称表 |  |\n| --- | --- |\n| 甲 | 乙 |\n')
})

test('光标在表格中时表格带 is-active（编辑时显示单元格边界），离开表格后去掉', () => {
  const view = viewOf('前文\n\n| 名称 | 数量 |\n| --- | --- |\n| 甲 | 1 |')
  const table = () => view.dom.querySelector('table')!
  expect(table().classList.contains('is-active')).toBe(false)

  cursorAfter(view, '甲')
  expect(table().classList.contains('is-active')).toBe(true)

  cursorAfter(view, '前文')
  expect(table().classList.contains('is-active')).toBe(false)
  expect(markdown(view)).toBe('前文\n\n| 名称 | 数量 |\n| --- | --- |\n| 甲 | 1 |\n')
})

test('章节第一行是空段落、后面还有内容时，按 Backspace 删掉这一行，光标进入下一块开头', () => {
  for (const [source, expected, cursorIn] of [
    ['正文', '正文\n', 'paragraph'],
    ['> 引用', '> 引用\n', 'paragraph'],
    ['- 列表', '- 列表\n', 'paragraph'],
    ['| a | b |\n| --- | --- |\n| 1 | 2 |', '| a | b |\n| --- | --- |\n| 1 | 2 |\n', 'table_header'],
  ] as const) {
    const view = viewOf(`第一行\n\n${source}`)
    view.dispatch(view.state.tr.delete(1, 1 + '第一行'.length))
    view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)))
    expect(press(view, 'Backspace'), source).toBe(true)
    expect(markdown(view), source).toBe(expected)
    expect(view.state.selection.$from.parent.type.name, source).toBe(cursorIn)
    expect(view.state.selection.$from.parentOffset, source).toBe(0)
  }
})

test('只有一个空段落、或第一行不是空段落时，段首 Backspace 不删除', () => {
  const empty = viewOf('')
  press(empty, 'Backspace')
  expect(empty.state.doc.childCount).toBe(1)

  const text = viewOf('第一行\n\n第二行')
  text.dispatch(text.state.tr.setSelection(Selection.atStart(text.state.doc)))
  press(text, 'Backspace')
  expect(markdown(text)).toBe('第一行\n\n第二行\n')
})

test('系统的撤销 / 重做（编辑菜单、焦点不在正文时的 Cmd+Z）使用编辑器的撤销历史（prosemirror-history 处理）', () => {
  const view = viewOf('引言')
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  typeText(view, '补充')
  const undoEvent = new InputEvent('beforeinput', { inputType: 'historyUndo', cancelable: true })
  view.dom.dispatchEvent(undoEvent)
  expect(undoEvent.defaultPrevented).toBe(true)
  expect(markdown(view)).toBe('引言\n')
  view.dom.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyRedo', cancelable: true }))
  expect(markdown(view)).toBe('引言补充\n')
})

test('粘贴：去掉网页、Word、WPS 用来制造段间距的空段落', () => {
  const view = viewOf('')
  view.pasteHTML('<p>第一段</p><p>&nbsp;</p><p><br></p><p><span>\u3000</span></p><p><o:p></o:p></p><p>第二段</p>')
  expect(view.state.doc.childCount).toBe(2)
  expect(markdown(view)).toBe('第一段\n\n第二段\n')
})

const FIGURE = '![图](../assets/图.png)'

/** 文档中第一张独立成段的图片（figure）的位置。 */
function figurePos(view: EditorView): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'figure') found = pos
  })
  return found
}

function selectFigure(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, figurePos(view))))
}

function cursorAt(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

test('独占一段的图片是块级原子节点：文档中没有"图片旁边"的文字位置', () => {
  const view = viewOf(`前文\n\n${FIGURE}\n\n后文`)
  const { doc } = view.state
  const figure = figurePos(view)
  expect(doc.child(1).type.name).toBe('figure')
  for (let pos = 0; pos <= doc.content.size; pos++) {
    expect(doc.resolve(pos).parent.type.name).not.toBe('figure')
  }
  // 从图片前后找最近的光标位置，只会落在前后的段落里。
  expect(Selection.near(doc.resolve(figure), -1).$from.parent.textContent).toBe('前文')
  expect(Selection.near(doc.resolve(figure + 1), 1).$from.parent.textContent).toBe('后文')
})

test('图片：选中图片按 Enter 在其后新建段落；图片之前 / 之后的空隙处按 Enter 在空隙处新建段落', async () => {
  const { GapCursor } = await import('prosemirror-gapcursor')
  const view = viewOf(`前文\n\n${FIGURE}`)
  selectFigure(view)
  press(view, 'Enter')
  typeText(view, '图后')
  expect(markdown(view)).toBe(`前文\n\n${FIGURE}\n\n图后\n`)

  const gap = viewOf(`${FIGURE}\n\n${FIGURE}`)
  gap.dispatch(gap.state.tr.setSelection(new GapCursor(gap.state.doc.resolve(1))))
  press(gap, 'Enter')
  typeText(gap, '两图之间')
  expect(markdown(gap)).toBe(`${FIGURE}\n\n两图之间\n\n${FIGURE}\n`)
})

test('图片是章节的最后 / 第一个块时，↓ / ↑ 移到它之后 / 之前的空隙，直接输入即成为新段落', async () => {
  const { GapCursor } = await import('prosemirror-gapcursor')
  const view = viewOf(FIGURE)
  selectFigure(view)
  press(view, 'ArrowDown')
  expect(view.state.selection).toBeInstanceOf(GapCursor)
  typeText(view, '后')
  selectFigure(view)
  press(view, 'ArrowUp')
  expect(view.state.selection).toBeInstanceOf(GapCursor)
  typeText(view, '前')
  expect(markdown(view)).toBe(`前\n\n${FIGURE}\n\n后\n`)
})

test('图片：后一段段首 Backspace / 前一段段尾 Delete 先选中图片，再按一次删除，可撤销', () => {
  const view = viewOf(`${FIGURE}\n\n正文`)
  cursorAt(view, view.state.doc.firstChild!.nodeSize + 1)
  press(view, 'Backspace')
  expect(view.state.selection).toBeInstanceOf(NodeSelection)
  expect(markdown(view)).toBe(`${FIGURE}\n\n正文\n`)
  press(view, 'Backspace')
  expect(markdown(view)).toBe('正文\n')
  press(view, 'z', { mod: true })
  expect(markdown(view)).toBe(`${FIGURE}\n\n正文\n`)

  const before = viewOf(`正文\n\n${FIGURE}`)
  cursorAfter(before, '正文')
  press(before, 'Delete')
  expect(before.state.selection).toBeInstanceOf(NodeSelection)
  expect(markdown(before)).toBe(`正文\n\n${FIGURE}\n`)

  // 图片后的空段落：Backspace 删掉空段落并选中图片。
  const empty = viewOf(FIGURE)
  selectFigure(empty)
  press(empty, 'Enter')
  press(empty, 'Backspace')
  expect(empty.state.doc.childCount).toBe(1)
  expect(empty.state.selection).toBeInstanceOf(NodeSelection)
})

test('编辑使段落只剩一张图片时（删掉旁边的文字、粘贴只含图片的段落）成为 figure；带链接的图片与仍有文字的段落不变', () => {
  const view = viewOf('![图](../assets/图.png)文')
  expect(view.state.doc.firstChild!.type.name).toBe('paragraph')
  // 删掉"文"（段落内的删字由浏览器完成，这里直接用事务）。
  const textEnd = view.state.doc.firstChild!.nodeSize - 1
  view.dispatch(view.state.tr.delete(textEnd - 1, textEnd))
  expect(view.state.doc.firstChild!.type.name).toBe('figure')
  expect(view.state.selection).toBeInstanceOf(NodeSelection)
  // 一次撤销回到删除之前，图片仍在原来的段落中。
  press(view, 'z', { mod: true })
  expect(markdown(view)).toBe('![图](../assets/图.png)文\n')

  const pasted = viewOf('')
  pasted.pasteHTML('<p>前文</p><p><img src="../assets/图.png" alt="图"></p><p>后文</p>')
  expect(pasted.state.doc.child(1).type.name).toBe('figure')

  const linked = viewOf('[![图](../assets/图.png)](https://example.com)文')
  const linkedEnd = linked.state.doc.firstChild!.nodeSize - 1
  linked.dispatch(linked.state.tr.delete(linkedEnd - 1, linkedEnd))
  expect(linked.state.doc.firstChild!.type.name).toBe('paragraph')
  expect(markdown(linked)).toBe('[![图](../assets/图.png)](https://example.com)\n')
})

test('输入法组字中的修改不转换成 figure，组字结束后的下一次修改才转换', () => {
  const view = viewOf('![图](../assets/图.png)文\n\n下一段')
  const end = view.state.doc.firstChild!.nodeSize - 1
  view.dispatch(view.state.tr.delete(end - 1, end).setMeta('composition', 1))
  expect(view.state.doc.firstChild!.type.name).toBe('paragraph')
  view.dispatch(view.state.tr.insertText('。', view.state.doc.content.size - 1))
  expect(view.state.doc.firstChild!.type.name).toBe('figure')
})

test('点击最后一块（代码块、表格、图片、分隔线）下方的空白：在章节末尾新建段落；最后是普通段落时照常处理', () => {
  // happy-dom 没有排版，块的下边缘都是 0：任何 clientY > 0 的点击都在其下方。
  const click = (view: EditorView) =>
    view.someProp('handleClick', (handle) => handle(view, 1, new MouseEvent('click', { clientY: 100 }))) ?? false
  for (const source of ['```\ncode\n```', FIGURE, '---', '| a |\n| - |\n| b |']) {
    const view = viewOf(source)
    expect(click(view)).toBe(true)
    typeText(view, '继续')
    expect(markdown(view)).toBe(`${serializeChapter(parseMarkdown(source)).trimEnd()}\n\n继续\n`)
  }
  expect(click(viewOf('段落'))).toBe(false)
})
