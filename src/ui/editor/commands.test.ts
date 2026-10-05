import { describe, expect, test } from 'vitest'
import { NodeSelection, TextSelection, type Command, type EditorState } from 'prosemirror-state'
import { closeHistory, redo, undo } from 'prosemirror-history'
import { parseMarkdown, serializeChapter } from './markdown.ts'
import { createEditorState } from './plugins.ts'
import {
  insertImage,
  insertTable,
  toggleBold,
  exitMarksForward,
  toggleSubscript,
  toggleSuperscript,
  toggleBulletList,
  toggleCodeBlock,
  toggleItalic,
  toggleOrderedList,
  toggleTaskList,
  toggleQuote,
  commandState,
  editorCommands,
  setCodeLanguage,
  insertChapterRef,
  setChapterRefShow,
} from './commands.ts'
import { nodes } from './schema.ts'
import { CellSelection } from 'prosemirror-tables'

/** 文档中某段文字的位置（第一次出现）。 */
function find(state: EditorState, needle: string): number {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle)
    return true
  })
  if (found < 0) throw new Error(`"${needle}" not found`)
  return found
}

/** 由 Markdown 创建状态；select 为要选中的文字，cursorAfter 为光标要放在其后的文字。 */
function stateOf(markdown: string, where: { select?: string; cursorAfter?: string; cursorBefore?: string } = {}) {
  let state = createEditorState(parseMarkdown(markdown))
  const { select, cursorAfter, cursorBefore } = where
  let selection: TextSelection | null = null
  if (select) selection = TextSelection.create(state.doc, find(state, select), find(state, select) + select.length)
  if (cursorAfter) selection = TextSelection.create(state.doc, find(state, cursorAfter) + cursorAfter.length)
  if (cursorBefore) selection = TextSelection.create(state.doc, find(state, cursorBefore))
  if (selection) state = state.apply(state.tr.setSelection(selection))
  return state
}

function run(state: EditorState, command: Command): EditorState {
  let next: EditorState | null = null
  const handled = command(state, (tr) => (next = state.apply(tr)))
  expect(handled).toBe(true)
  return next ?? state
}

function markdown(state: EditorState): string {
  return serializeChapter(state.doc)
}

describe('行内格式', () => {
  test('粗体 / 斜体：选区加上与去掉格式', () => {
    const bold = run(stateOf('引言正文', { select: '正文' }), toggleBold)
    expect(markdown(bold)).toBe('引言**正文**\n')
    expect(markdown(run(bold, toggleBold))).toBe('引言正文\n')
    expect(markdown(run(stateOf('引言正文', { select: '引言' }), toggleItalic))).toBe('*引言*正文\n')
  })

  test('上标 / 下标：选区加上与去掉格式；两者互斥，设置一种时替换另一种', () => {
    const sup = run(stateOf('m3/d', { select: '3' }), toggleSuperscript)
    expect(markdown(sup)).toBe('m<sup>3</sup>/d\n')
    expect(commandState(sup).superscript.active).toBe(true)
    expect(commandState(sup).subscript.active).toBe(false)
    const sub = run(sup, toggleSubscript)
    expect(markdown(sub)).toBe('m<sub>3</sub>/d\n')
    expect(commandState(sub).superscript.active).toBe(false)
    expect(markdown(run(sub, toggleSubscript))).toBe('m3/d\n')
    // 没有选区时设置之后输入的格式。
    const typing = run(stateOf('H', { cursorAfter: 'H' }), toggleSubscript)
    expect(markdown(typing.apply(typing.tr.insertText('2')))).toBe('H<sub>2</sub>\n')
    // 代码块中不能设置。
    expect(commandState(stateOf('```\nx\n```', { cursorAfter: 'x' })).superscript.enabled).toBe(false)
  })

  test('在格式末尾按 → 离开格式：光标不动，之后输入普通文字；再按一次才移动光标', () => {
    const type = (state: EditorState, value: string) => state.apply(state.tr.insertText(value))
    // 段尾的上标。
    const end = stateOf('m<sup>3</sup>', { cursorAfter: '3' })
    const left = run(end, exitMarksForward)
    expect(left.selection.head).toBe(end.selection.head)
    expect(commandState(left).superscript.active).toBe(false)
    expect(markdown(type(left, '/d'))).toBe('m<sup>3</sup>/d\n')
    expect(exitMarksForward(left)).toBe(false)
    // 段落中间的粗体、下标、斜体。
    expect(markdown(type(run(stateOf('是**重要**的', { cursorAfter: '重要' }), exitMarksForward), '而'))).toBe('是**重要**而的\n')
    expect(markdown(type(run(stateOf('H<sub>2</sub>O', { cursorAfter: '2' }), exitMarksForward), 'x'))).toBe('H<sub>2</sub>xO\n')
    // 后面的文字也有的格式保留：粗体中的上标末尾只离开上标。
    const nested = run(stateOf('**m<sup>3</sup>/d**', { cursorAfter: '3' }), exitMarksForward)
    expect(markdown(type(nested, 'x'))).toBe('**m**<sup>**3**</sup>**x/d**\n')
    // 不在格式末尾（格式中间、普通文字中、刚设置了格式还没有输入）时 → 照常移动。
    expect(exitMarksForward(stateOf('**重要**', { cursorAfter: '重' }))).toBe(false)
    expect(exitMarksForward(stateOf('普通文字', { cursorAfter: '普通' }))).toBe(false)
    const toggled = run(stateOf('m', { cursorAfter: 'm' }), toggleSuperscript)
    expect(commandState(run(toggled, exitMarksForward)).superscript.active).toBe(false)
  })

  test('没有选区时设置之后输入的格式', () => {
    const state = run(stateOf('引言', { cursorAfter: '引言' }), toggleBold)
    const typed = state.apply(state.tr.insertText('加粗'))
    expect(markdown(typed)).toBe('引言**加粗**\n')
  })
})

describe('列表与引用', () => {
  test('空段落与多段正文转成任务列表，支持撤销与再次移出', () => {
    const empty = run(stateOf(''), toggleTaskList)
    expect(empty.doc.firstChild?.firstChild?.attrs.checked).toBe(false)
    const state = stateOf('甲\n\n乙\n')
    const all = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)))
    const tasks = run(all, toggleTaskList)
    expect(markdown(tasks)).toBe('- [ ] 甲\n- [ ] 乙\n')
    expect(commandState(tasks)['task-list'].active).toBe(true)
    expect(commandState(tasks)['bullet-list'].active).toBe(false)
    expect(markdown(run(tasks, undo))).toBe('甲\n\n乙\n')
    expect(markdown(run(run(stateOf('甲'), toggleTaskList), toggleTaskList))).toBe('甲\n')
  })

  test('列表类型转换只改变当前层，保留嵌套内容与已完成状态', () => {
    const state = stateOf('1. 甲\n   - [x] 子任务\n2. [x] 乙\n', { cursorBefore: '甲' })
    const tasks = run(state, toggleTaskList)
    expect(markdown(tasks)).toBe('- [ ] 甲\n  - [x] 子任务\n- [x] 乙\n')
    const bullets = run(tasks, toggleBulletList)
    expect(markdown(bullets)).toBe('- 甲\n  - [x] 子任务\n- 乙\n')
    expect(markdown(run(tasks, toggleOrderedList))).toBe('1. 甲\n   - [x] 子任务\n2. 乙\n')
  })
  test('无序列表：包成列表、再次点击移出列表', () => {
    const listed = run(stateOf('第一项', { cursorAfter: '第一' }), toggleBulletList)
    expect(markdown(listed)).toBe('- 第一项\n')
    expect(markdown(run(listed, toggleBulletList))).toBe('第一项\n')
  })

  test('多段一起变成列表；在无序与有序列表之间切换', () => {
    const state = stateOf('甲\n\n乙\n', {})
    const all = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)))
    const bullets = run(all, toggleBulletList)
    expect(markdown(bullets)).toBe('- 甲\n- 乙\n')
    expect(markdown(run(bullets, toggleOrderedList))).toBe('1. 甲\n2. 乙\n')
  })

  test('引用：包成引用、再次点击移出引用', () => {
    const quoted = run(stateOf('名言', { cursorAfter: '名' }), toggleQuote)
    expect(markdown(quoted)).toBe('> 名言\n')
    expect(markdown(run(quoted, toggleQuote))).toBe('名言\n')
  })
})

describe('代码块', () => {
  test('当前段落变成代码块，再次点击变回段落', () => {
    const code = run(stateOf('print(1)', { cursorAfter: 'print' }), toggleCodeBlock)
    expect(markdown(code)).toBe('```\nprint(1)\n```\n')
    expect(markdown(run(code, toggleCodeBlock))).toBe('print(1)\n')
  })

  test('选中的多段合成一个代码块，每段一行；多行代码变回段落时换行成为硬换行', () => {
    const state = stateOf('a = 1\n\nb = 2\n')
    const all = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)))
    const code = run(all, toggleCodeBlock)
    expect(code.doc.childCount).toBe(1)
    expect(markdown(code)).toBe('```\na = 1\nb = 2\n```\n')
    expect(markdown(run(code, toggleCodeBlock))).toBe('a = 1\\\nb = 2\n')
  })
})

describe('插入表格与图片', () => {
  test('表格插入在段落中间时拆开段落，光标在第一个表头单元格', () => {
    const state = run(stateOf('前文后文', { cursorAfter: '前文' }), insertTable)
    expect(markdown(state)).toBe('前文\n\n|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n\n后文\n')
    expect(state.selection.$from.parent.type.name).toBe('table_header')
    const typed = state.apply(state.tr.insertText('列 1'))
    expect(markdown(typed)).toContain('| 列 1 |  |  |')
  })

  test('空段落中插入表格直接替换该段落', () => {
    const state = run(stateOf(''), insertTable)
    expect(state.doc.childCount).toBe(1)
    expect(state.doc.child(0).type).toBe(nodes.table)
    expect(state.selection.$from.parent.type.name).toBe('table_header')
  })

  test('表格单元格与代码块中不能插入表格', () => {
    const inCell = stateOf('| a | b |\n| --- | --- |\n| c | d |\n', { cursorAfter: 'c' })
    expect(insertTable(inCell)).toBe(false)
    expect(insertTable(stateOf('```\ncode\n```', { cursorAfter: 'co' }))).toBe(false)
  })

  test('图片作为独立的一段插入在光标处', () => {
    const state = run(stateOf('引言', { cursorAfter: '引言' }), insertImage('../assets/图.png', '图'))
    expect(markdown(state)).toBe('引言\n\n![图](../assets/图.png)\n')
    const middle = run(stateOf('前文后文', { cursorAfter: '前文' }), insertImage('../assets/图.png', '图'))
    expect(markdown(middle)).toBe('前文\n\n![图](../assets/图.png)\n\n后文\n')
  })

  test('插入图片后光标在图片之后的段落中，可以直接继续写；之后没有段落时新建一个', () => {
    const atEnd = run(stateOf('引言', { cursorAfter: '引言' }), insertImage('../assets/图.png', '图'))
    expect(atEnd.doc.childCount).toBe(3)
    expect(atEnd.selection.$from.parent).toBe(atEnd.doc.lastChild)
    expect(atEnd.selection.$from.parent.content.size).toBe(0)
    expect(markdown(atEnd)).toBe('引言\n\n![图](../assets/图.png)\n')

    const middle = run(stateOf('前文后文', { cursorAfter: '前文' }), insertImage('../assets/图.png', '图'))
    expect(middle.doc.childCount).toBe(3)
    expect(middle.selection.from).toBe(find(middle, '后文'))
  })

  test('表格单元格中图片作为行内图片插入；代码块中不能插入', () => {
    const inCell = run(
      stateOf('| a | b |\n| --- | --- |\n| c | d |\n', { cursorAfter: 'c' }),
      insertImage('i.png', 'i'),
    )
    expect(markdown(inCell)).toContain('| c![i](i.png) | d |')
    expect(insertImage('i.png', 'i')(stateOf('```\ncode\n```', { cursorAfter: 'co' }))).toBe(false)
  })
})

describe('表格的行与列', () => {
  const TABLE = '| A | B |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |\n\n后文\n'

  /** 光标所在单元格的文字（新插入的单元格为空）。 */
  function cellText(state: EditorState): string {
    const { $from } = state.selection
    expect($from.parent.type.spec.tableRole).toMatch(/cell/)
    return $from.parent.textContent
  }

  /** 光标所在单元格的行、列（从 0 开始，表头是第 0 行）。 */
  function cellAt(state: EditorState): { row: number; col: number } {
    const { $from } = state.selection
    return { row: $from.index($from.depth - 2), col: $from.index($from.depth - 1) }
  }

  test('插入行后光标在新行的同一列，可以直接输入', () => {
    const after = run(stateOf(TABLE, { cursorAfter: 'b1' }), editorCommands['row-after'])
    expect(cellAt(after)).toEqual({ row: 2, col: 1 })
    expect(markdown(after.apply(after.tr.insertText('新')))).toContain('| a1 | b1 |\n|  | 新 |\n| a2 | b2 |')

    const before = run(stateOf(TABLE, { cursorAfter: 'b2' }), editorCommands['row-before'])
    expect(cellAt(before)).toEqual({ row: 2, col: 1 })
    expect(cellText(before)).toBe('')
  })

  test('插入列后光标在新列的同一行', () => {
    const after = run(stateOf(TABLE, { cursorAfter: 'a2' }), editorCommands['column-after'])
    expect(cellAt(after)).toEqual({ row: 2, col: 1 })
    expect(markdown(after.apply(after.tr.insertText('新')))).toContain('| a2 | 新 | b2 |')

    const before = run(stateOf(TABLE, { cursorAfter: 'A' }), editorCommands['column-before'])
    expect(cellAt(before)).toEqual({ row: 0, col: 0 })
    expect(before.selection.$from.parent.type).toBe(nodes.table_header)
  })

  test('删除行后光标留在表格中：进入下方的行，删除最后一行时进入上方的行', () => {
    expect(cellText(run(stateOf(TABLE, { cursorAfter: 'b1' }), editorCommands['delete-row']))).toBe('b2')
    const last = run(stateOf(TABLE, { cursorAfter: 'b2' }), editorCommands['delete-row'])
    expect(cellText(last)).toBe('b1')
    expect(last.selection.$from.parentOffset).toBe(2)
    const only = run(stateOf('| A |\n| --- |\n| x |\n', { cursorAfter: 'x' }), editorCommands['delete-row'])
    expect(markdown(only)).toBe('| A |\n| --- |\n')
    expect(cellText(only)).toBe('A')
  })

  test('删除列后光标留在表格中：进入右侧的列，删除最后一列时进入左侧的列', () => {
    expect(cellText(run(stateOf(TABLE, { cursorAfter: 'a2' }), editorCommands['delete-column']))).toBe('b2')
    expect(cellText(run(stateOf(TABLE, { cursorAfter: 'b2' }), editorCommands['delete-column']))).toBe('a2')
  })

  test('表头行不能删除、上方不能插入行；只剩一列时不能删除列', () => {
    const header = stateOf(TABLE, { cursorAfter: 'A' })
    expect(editorCommands['delete-row'](header)).toBe(false)
    expect(editorCommands['row-before'](header)).toBe(false)
    expect(editorCommands['delete-column'](stateOf('| A |\n| --- |\n| x |\n', { cursorAfter: 'x' }))).toBe(false)
  })

  test('表格之外不可用', () => {
    const outside = commandState(stateOf(TABLE, { cursorAfter: '后文' }))
    for (const command of ['row-before', 'row-after', 'column-before', 'column-after', 'delete-row', 'delete-column'] as const) {
      expect(outside[command].enabled).toBe(false)
    }
  })
})

describe('合并与拆分单元格（docs/decisions.md 第 23 节）', () => {
  const TABLE = '| A | B |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |\n'

  /** 选中从 from 所在单元格到 to 所在单元格的矩形。 */
  function selectCells(state: EditorState, from: string, to: string): EditorState {
    const cell = (text: string) => {
      const $pos = state.doc.resolve(find(state, text))
      return $pos.before($pos.depth)
    }
    return state.apply(state.tr.setSelection(CellSelection.create(state.doc, cell(from), cell(to))))
  }

  test('横向、纵向合并：内容以空格连接，写出合并记号', () => {
    expect(markdown(run(selectCells(stateOf(TABLE), 'a1', 'b1'), editorCommands['merge-cells']))).toBe(
      '| A | B |\n| --- | --- |\n| a1 b1 ||\n| a2 | b2 |\n',
    )
    expect(markdown(run(selectCells(stateOf(TABLE), 'a1', 'a2'), editorCommands['merge-cells']))).toBe(
      '| A | B |\n| --- | --- |\n| a1 a2 | b1 |\n| ^^ | b2 |\n',
    )
    expect(markdown(run(selectCells(stateOf(TABLE), 'A', 'B'), editorCommands['merge-cells']))).toBe(
      '| A B ||\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |\n',
    )
  })

  test('表头不能与正文合并；没有选中多个单元格时不能合并', () => {
    expect(editorCommands['merge-cells'](selectCells(stateOf(TABLE), 'A', 'a1'))).toBe(false)
    expect(commandState(stateOf(TABLE, { cursorAfter: 'a1' }))['merge-cells'].enabled).toBe(false)
  })

  test('拆分：内容留在第一个单元格，其余为空；没有合并的单元格不能拆分', () => {
    const merged = run(selectCells(stateOf(TABLE), 'a1', 'b2'), editorCommands['merge-cells'])
    expect(markdown(merged)).toBe('| A | B |\n| --- | --- |\n| a1 b1 a2 b2 ||\n| ^^ ||\n')
    expect(markdown(run(merged, editorCommands['split-cell']))).toBe(
      '| A | B |\n| --- | --- |\n| a1 b1 a2 b2 |  |\n|  |  |\n',
    )
    expect(commandState(stateOf(TABLE, { cursorAfter: 'a1' }))['split-cell'].enabled).toBe(false)
  })

  test('在合并区域中插入行时区域随之变高', () => {
    const merged = run(selectCells(stateOf(TABLE), 'a1', 'a2'), editorCommands['merge-cells'])
    const cursor = merged.apply(merged.tr.setSelection(TextSelection.create(merged.doc, find(merged, 'b1') + 2)))
    expect(markdown(run(cursor, editorCommands['row-after']))).toBe(
      '| A | B |\n| --- | --- |\n| a1 a2 | b1 |\n| ^^ |  |\n| ^^ | b2 |\n',
    )
  })
})

describe('多行表头（docs/decisions.md 第 23 节）', () => {
  const TABLE = '| A | B |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |\n'

  test('表头行：第一个正文行设为表头，最后一个表头行改回正文', () => {
    const header = run(stateOf(TABLE, { cursorAfter: 'a1' }), editorCommands['header-row'])
    expect(markdown(header)).toBe('| A | B |\n| a1 | b1 |\n| --- | --- |\n| a2 | b2 |\n')
    expect(commandState(header.apply(header.tr.setSelection(TextSelection.create(header.doc, find(header, 'a1')))))['header-row'].active).toBe(true)
    const back = header.apply(header.tr.setSelection(TextSelection.create(header.doc, find(header, 'a1'))))
    expect(markdown(run(back, editorCommands['header-row']))).toBe(TABLE)
  })

  test('表头行：唯一的表头行、不相邻的行、被合并的单元格跨过分界时不可用', () => {
    expect(editorCommands['header-row'](stateOf(TABLE, { cursorAfter: 'A' }))).toBe(false)
    expect(editorCommands['header-row'](stateOf(TABLE, { cursorAfter: 'a2' }))).toBe(false)
    expect(editorCommands['header-row'](stateOf('| A | B |\n| --- | --- |\n| a1 | b1 |\n| ^^ | b2 |\n', { cursorAfter: 'b1' }))).toBe(false)
  })

  const TWO = '| A | B |\n| C | D |\n| --- | --- |\n| a1 | b1 |\n'

  test('表头行之间插入的是表头行；最后一个表头行下方插入的是正文行；第一行上方不能插入', () => {
    expect(markdown(run(stateOf(TWO, { cursorAfter: 'C' }), editorCommands['row-before']))).toBe(
      '| A | B |\n|  |  |\n| C | D |\n| --- | --- |\n| a1 | b1 |\n',
    )
    expect(markdown(run(stateOf(TWO, { cursorAfter: 'C' }), editorCommands['row-after']))).toBe(
      '| A | B |\n| C | D |\n| --- | --- |\n|  |  |\n| a1 | b1 |\n',
    )
    expect(editorCommands['row-before'](stateOf(TWO, { cursorAfter: 'A' }))).toBe(false)
  })

  test('表头至少保留一行：多行表头时可以删除其中的行', () => {
    expect(markdown(run(stateOf(TWO, { cursorAfter: 'A' }), editorCommands['delete-row']))).toBe(
      '| C | D |\n| --- | --- |\n| a1 | b1 |\n',
    )
    expect(editorCommands['delete-row'](stateOf(TABLE, { cursorAfter: 'A' }))).toBe(false)
  })

  test('表头内可以纵向合并，但不能与正文合并', () => {
    let state = stateOf(TWO)
    const cell = (text: string) => {
      const $pos = state.doc.resolve(find(state, text))
      return $pos.before($pos.depth)
    }
    state = state.apply(state.tr.setSelection(CellSelection.create(state.doc, cell('A'), cell('C'))))
    expect(markdown(run(state, editorCommands['merge-cells']))).toBe('| A C | B |\n| ^^ | D |\n| --- | --- |\n| a1 | b1 |\n')
    state = stateOf(TWO)
    state = state.apply(state.tr.setSelection(CellSelection.create(state.doc, cell('C'), cell('a1'))))
    expect(editorCommands['merge-cells'](state)).toBe(false)
  })
})

describe('撤销 / 重做', () => {
  test('格式与插入都可以撤销和重做', () => {
    const start = stateOf('引言正文', { select: '正文' })
    const bold = run(start, toggleBold)
    // 两次操作之间结束一个撤销组（真实输入中由时间间隔决定）。
    const table = run(bold.apply(closeHistory(bold.tr)), insertTable)
    const undone = run(run(table, undo), undo)
    expect(markdown(undone)).toBe('引言正文\n')
    expect(markdown(run(undone, redo))).toBe('引言**正文**\n')
  })
})

describe('工具栏状态', () => {
  test('激活状态来自光标处的结构与格式', () => {
    const state = stateOf('> - **粗体**文字\n', { cursorAfter: '粗' })
    const toolbar = commandState(state)
    expect(toolbar.bold.active).toBe(true)
    expect(toolbar.italic.active).toBe(false)
    expect(toolbar['bullet-list'].active).toBe(true)
    expect(toolbar['ordered-list'].active).toBe(false)
    expect(toolbar.quote.active).toBe(true)
    expect(commandState(stateOf('> - **粗体**文字\n', { cursorAfter: '文' })).bold.active).toBe(false)
  })

  test('代码块中格式不可用；表格中不能插入表格与列表', () => {
    const code = commandState(stateOf('```\ncode\n```', { cursorAfter: 'co' }))
    expect(code.bold.enabled).toBe(false)
    expect(code['code-block']).toEqual({ enabled: true, active: true })
    expect(code.table.enabled).toBe(false)
    const cell = commandState(stateOf('| a | b |\n| --- | --- |\n| c | d |\n', { cursorAfter: 'c' }))
    expect(cell.bold.enabled).toBe(true)
    expect(cell.table.enabled).toBe(false)
    expect(cell['bullet-list'].enabled).toBe(false)
    expect(cell.image.enabled).toBe(true)
  })
})

describe('代码语言', () => {
  test('设置光标所在代码块的语言，保留信息字符串的其余部分；自动识别去掉信息字符串', () => {
    const plain = stateOf('```\nx = 1\n```\n', { cursorAfter: 'x' })
    const python = run(plain, setCodeLanguage('python'))
    expect(markdown(python)).toBe('```python\nx = 1\n```\n')
    const titled = run(stateOf('```js title="a.js"\nx\n```\n', { cursorAfter: 'x' }), setCodeLanguage('typescript'))
    expect(markdown(titled)).toBe('```typescript title="a.js"\nx\n```\n')
    expect(markdown(run(python, setCodeLanguage('')))).toBe('```\nx = 1\n```\n')
  })

  test('不在代码块中时不可用', () => {
    expect(setCodeLanguage('python')(stateOf('正文', { cursorAfter: '正' }))).toBe(false)
  })
})

describe('章节引用', () => {
  test('插入到光标处，替换选中的文字；代码块中不能插入', () => {
    const inserted = run(stateOf('见本节', { select: '本节' }), insertChapterRef('writer:chapter/a', '2.1 方法'))
    expect(markdown(inserted)).toBe('见[2.1 方法](writer:chapter/a)\n')
    expect(insertChapterRef('writer:chapter/a', '')(stateOf('```\ncode\n```', { cursorAfter: 'co' }))).toBe(false)
  })

  test('选中引用时更换目标并保留强调；更改显示格式；地址格式错误的不能更改格式', () => {
    let state = stateOf('**[旧](writer:chapter/a)** 之后')
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 1)))
    const changed = run(state, insertChapterRef('writer:chapter/b?show=title', '结果'))
    expect(markdown(changed)).toBe('**[结果](writer:chapter/b?show=title)** 之后\n')
    expect(markdown(run(changed, setChapterRefShow('number')))).toBe('**[结果](writer:chapter/b?show=number)** 之后\n')

    let broken = stateOf('[坏](writer:chapter/)')
    broken = broken.apply(broken.tr.setSelection(NodeSelection.create(broken.doc, 1)))
    expect(setChapterRefShow('number')(broken)).toBe(false)
  })
})
