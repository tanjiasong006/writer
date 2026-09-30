import type { Node, NodeType, ResolvedPos } from 'prosemirror-model'
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { chainCommands, lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import { liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list'
import { redo as historyRedo, undo as historyUndo } from 'prosemirror-history'
import { undoInputRule } from 'prosemirror-inputrules'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  selectedRect,
  TableMap,
  type TableRect,
} from 'prosemirror-tables'
import { marks, nodes } from './schema.ts'

/**
 * 正文编辑命令。都是标准的 ProseMirror Command：只根据 EditorState 计算事务，不依赖 DOM。
 * 菜单栏、右键菜单与工具栏中各项的可用 / 勾选状态同样由这里根据 EditorState 推导（commandState），
 * 不另外维护一份格式状态。
 */

export type EditorCommand =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'bullet-list'
  | 'ordered-list'
  | 'quote'
  | 'code-block'
  | 'indent'
  | 'outdent'
  | 'table'
  | 'image'
  | 'row-before'
  | 'row-after'
  | 'column-before'
  | 'column-after'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table'

export interface CommandItemState {
  readonly enabled: boolean
  readonly active: boolean
}

export type CommandState = Readonly<Record<EditorCommand, CommandItemState>>

/** 选区所在的最近一层列表（及其深度）。 */
function nearestList($pos: ResolvedPos): { node: Node; depth: number } | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (node.type === nodes.bullet_list || node.type === nodes.ordered_list) return { node, depth }
  }
  return null
}

function hasAncestor($pos: ResolvedPos, type: NodeType): boolean {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type === type) return true
  }
  return false
}

function markActive(state: EditorState, type: (typeof marks)[string]): boolean {
  const { from, $from, to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks())
  return state.doc.rangeHasMark(from, to, type)
}

export const toggleBold: Command = toggleMark(marks.strong)
export const toggleItalic: Command = toggleMark(marks.em)
export const toggleStrike: Command = toggleMark(marks.strike)
export const toggleCode: Command = toggleMark(marks.code)

/** 撤销：刚由输入规则转换（如 "- " 变成列表）时回到转换前的文字，与快捷键相同。 */
export const undo: Command = chainCommands(undoInputRule, historyUndo)
export const redo: Command = historyRedo
export const indentListItem: Command = sinkListItem(nodes.list_item)
export const outdentListItem: Command = liftListItem(nodes.list_item)

/**
 * 列表：不在列表中 → 包成列表；已在同类列表中 → 移出列表；在另一类列表中 → 改变列表类型。
 */
function toggleList(type: NodeType): Command {
  return (state, dispatch) => {
    const list = nearestList(state.selection.$from)
    if (!list) return wrapInList(type)(state, dispatch)
    if (list.node.type === type) return liftListItem(nodes.list_item)(state, dispatch)
    if (dispatch) {
      const pos = state.selection.$from.before(list.depth)
      dispatch(state.tr.setNodeMarkup(pos, type, { ...list.node.attrs }).scrollIntoView())
    }
    return true
  }
}

export const toggleBulletList = toggleList(nodes.bullet_list)
export const toggleOrderedList = toggleList(nodes.ordered_list)

/** 引用：在引用中 → 移出；否则包成引用。 */
export const toggleQuote: Command = (state, dispatch) => {
  if (hasAncestor(state.selection.$from, nodes.blockquote)) return lift(state, dispatch)
  return wrapIn(nodes.blockquote)(state, dispatch)
}

/**
 * 代码块：在代码块中 → 变回段落（代码中的换行变成硬换行）。
 * 否则把选中的连续段落合成一个代码块，每段一行；没有选区时把当前段落变成代码块。
 */
export const toggleCodeBlock: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  if ($from.parent.type === nodes.code_block) return setBlockType(nodes.paragraph)(state, dispatch)
  const range = $from.blockRange($to)
  if (!range) return false
  const blocks: Node[] = []
  for (let i = range.startIndex; i < range.endIndex; i++) blocks.push(range.parent.child(i))
  if (blocks.length <= 1 || !blocks.every((block) => block.isTextblock)) {
    return setBlockType(nodes.code_block)(state, dispatch)
  }
  if (!range.parent.canReplaceWith(range.startIndex, range.endIndex, nodes.code_block)) return false
  if (dispatch) {
    const text = blocks.map((block) => block.textContent).join('\n')
    const code = nodes.code_block.create(null, text ? state.schema.text(text) : null)
    const tr = state.tr.replaceWith(range.start, range.end, code)
    tr.setSelection(TextSelection.create(tr.doc, range.start + 1 + text.length))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/**
 * 设置光标所在代码块的语言（围栏信息字符串的第一个词，其余部分保留）；空字符串表示自动识别，
 * 这时去掉整个信息字符串。不在代码块中时不可用。
 */
export function setCodeLanguage(language: string): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    if ($from.parent.type !== nodes.code_block) return false
    if (dispatch) {
      const rest = ($from.parent.attrs.params as string).trim().split(/\s+/).slice(1)
      const params = language ? [language, ...rest].join(' ') : ''
      dispatch(state.tr.setNodeAttribute($from.before(), 'params', params))
    }
    return true
  }
}

function inTableCell($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const role = $pos.node(depth).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') return true
  }
  return false
}

/**
 * 在选区处插入一个块（表格、图）：先删除选中内容；光标在段落中间时拆开段落，
 * 在段首 / 段尾时插在段落之前 / 之后，空段落直接被替换。
 * 代码块与表格单元格中不能插入块。插入后由 place(事务, 块起点) 放置光标。
 */
function insertBlock(block: Node, place: (tr: Transaction, start: number) => void): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    if ($from.parent.type.spec.code || inTableCell($from)) return false
    if (!$from.parent.isTextblock && !$from.parent.canReplaceWith($from.index(), $from.index(), block.type)) {
      return false
    }
    if (!dispatch) return true
    const tr = state.tr.deleteSelection()
    const $pos = tr.selection.$from
    const parent = $pos.parent
    let start: number
    if (!parent.isTextblock) {
      start = $pos.pos
      tr.insert(start, block)
    } else if (parent.content.size === 0) {
      start = $pos.before()
      tr.replaceWith(start, $pos.after(), block)
    } else if ($pos.parentOffset === 0) {
      start = $pos.before()
      tr.insert(start, block)
    } else if ($pos.parentOffset === parent.content.size) {
      start = $pos.after()
      tr.insert(start, block)
    } else {
      tr.split($pos.pos)
      start = $pos.pos + 1
      tr.insert(start, block)
    }
    place(tr, start)
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** 3 列 × 3 行（含表头）的空表格，光标停在第一个表头单元格。 */
export const insertTable: Command = (state, dispatch) => {
  const row = (cell: NodeType) =>
    nodes.table_row.create(null, [cell.create(), cell.create(), cell.create()])
  const table = nodes.table.create(null, [
    row(nodes.table_header),
    row(nodes.table_cell),
    row(nodes.table_cell),
  ])
  return insertBlock(table, (tr, start) => tr.setSelection(TextSelection.create(tr.doc, start + 3)))(state, dispatch)
}

/**
 * 图片：reference 是正文可用的相对路径（如 ../assets/图.png）。
 * 正文中（段落里，或选中了一个块、光标在块之间的空隙时）作为独立的图（figure）插入，
 * 光标放在图片之后的段落中，可以直接继续写（之后不是普通段落时新建一个空段落）；
 * 表格单元格与标题中作为行内图片插入。
 */
export function insertImage(reference: string, alt: string): Command {
  const figure = nodes.figure.create({ src: reference, alt })
  const asBlock = insertBlock(figure, (tr, start) => {
    const after = start + figure.nodeSize
    if (tr.doc.resolve(after).nodeAfter?.type !== nodes.paragraph) tr.insert(after, nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, after + 1))
  })
  return (state, dispatch) => {
    const { $from } = state.selection
    if ($from.parent.type === nodes.paragraph || !$from.parent.isTextblock) return asBlock(state, dispatch)
    if (!$from.parent.canReplaceWith($from.index(), $from.indexAfter(), nodes.image)) return false
    const image = nodes.image.create({ src: reference, alt })
    if (dispatch) dispatch(state.tr.replaceSelectionWith(image).scrollIntoView())
    return true
  }
}

/** 选区在表格的表头行中（GFM 表格的第一行，必须保留且只能是表头）。 */
function inHeaderRow(state: EditorState): boolean {
  if (!isInTable(state)) return false
  return selectedRect(state).top === 0
}

/**
 * 表格的行列命令执行后把光标放进 target 给出的单元格（内容末尾），可以直接输入：
 * 插入后进入新行 / 新列，删除后留在原位置的相邻单元格，而不是停在原处或跳出表格。
 * target 由操作前的选区矩形与操作后的表格计算（行列操作不改变表格在文档中的位置）。
 */
function thenSelectCell(
  command: Command,
  target: (before: TableRect, after: TableMap) => { readonly row: number; readonly col: number },
): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false
    const before = selectedRect(state)
    return command(
      state,
      dispatch &&
        ((tr) => {
          const table = tr.doc.nodeAt(before.tableStart - 1)!
          const after = TableMap.get(table)
          const { row, col } = target(before, after)
          const cell = before.tableStart + after.positionAt(row, col, table)
          const end = cell + tr.doc.nodeAt(cell)!.nodeSize - 1
          dispatch(tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView())
        }),
    )
  }
}

/**
 * 表格的行操作：表头行只能是第一行，不能在它上方插入行，也不能删除它（删除整个表格用"删除表格"）；
 * 只剩一行正文时仍可以删除它，表格保留表头。
 */
const rowBefore = thenSelectCell(
  (state, dispatch) => !inHeaderRow(state) && addRowBefore(state, dispatch),
  (before) => ({ row: before.top, col: before.left }),
)
const rowAfter = thenSelectCell(addRowAfter, (before) => ({ row: before.bottom, col: before.left }))
const columnBefore = thenSelectCell(addColumnBefore, (before) => ({ row: before.top, col: before.left }))
const columnAfter = thenSelectCell(addColumnAfter, (before) => ({ row: before.top, col: before.right }))
/** 删除后进入下方的行；删除的是最后几行时进入上方的行。 */
const removeRow = thenSelectCell(
  (state, dispatch) => selectedRect(state).top > 0 && deleteRow(state, dispatch),
  (before, after) => ({ row: Math.min(before.top, after.height - 1), col: before.left }),
)
/** 只剩一列时不能再删除列（请删除表格）。删除后进入右侧的列；删除的是最后几列时进入左侧的列。 */
const removeColumn = thenSelectCell(
  (state, dispatch) => selectedRect(state).map.width > 1 && deleteColumn(state, dispatch),
  (before, after) => ({ row: before.top, col: Math.min(before.left, after.width - 1) }),
)

export const editorCommands: Readonly<Record<Exclude<EditorCommand, 'image'>, Command>> = {
  undo,
  redo,
  bold: toggleBold,
  italic: toggleItalic,
  strike: toggleStrike,
  code: toggleCode,
  'bullet-list': toggleBulletList,
  'ordered-list': toggleOrderedList,
  quote: toggleQuote,
  'code-block': toggleCodeBlock,
  indent: indentListItem,
  outdent: outdentListItem,
  table: insertTable,
  'row-before': rowBefore,
  'row-after': rowAfter,
  'column-before': columnBefore,
  'column-after': columnAfter,
  'delete-row': removeRow,
  'delete-column': removeColumn,
  'delete-table': deleteTable,
}

/** 每个编辑命令的可用 / 激活状态，全部由当前 EditorState 推导。 */
export function commandState(state: EditorState): CommandState {
  const { $from } = state.selection
  const list = nearestList($from)
  const can = (command: Command) => command(state)
  const plain = (command: Command): CommandItemState => ({ enabled: can(command), active: false })
  return {
    undo: plain(undo),
    redo: plain(redo),
    bold: { enabled: can(toggleBold), active: markActive(state, marks.strong) },
    italic: { enabled: can(toggleItalic), active: markActive(state, marks.em) },
    strike: { enabled: can(toggleStrike), active: markActive(state, marks.strike) },
    code: { enabled: can(toggleCode), active: markActive(state, marks.code) },
    'bullet-list': { enabled: can(toggleBulletList), active: list?.node.type === nodes.bullet_list },
    'ordered-list': { enabled: can(toggleOrderedList), active: list?.node.type === nodes.ordered_list },
    quote: { enabled: can(toggleQuote), active: hasAncestor($from, nodes.blockquote) },
    'code-block': { enabled: can(toggleCodeBlock), active: $from.parent.type === nodes.code_block },
    indent: plain(indentListItem),
    outdent: plain(outdentListItem),
    table: plain(insertTable),
    image: plain(insertImage('', '')),
    'row-before': plain(rowBefore),
    'row-after': plain(rowAfter),
    'column-before': plain(columnBefore),
    'column-after': plain(columnAfter),
    'delete-row': plain(removeRow),
    'delete-column': plain(removeColumn),
    'delete-table': plain(deleteTable),
  }
}
