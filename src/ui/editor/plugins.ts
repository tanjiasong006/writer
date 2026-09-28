import { Fragment, Slice, type Node, type NodeType, type ResolvedPos } from 'prosemirror-model'
import { EditorState, Plugin, Selection, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import {
  baseKeymap,
  chainCommands,
  exitCode,
  joinDown,
  joinUp,
  newlineInCode,
  selectParentNode,
  setBlockType,
} from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules'
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list'
import { addRowAfter, goToNextCell, isInTable, nextCell, selectionCell, tableEditing } from 'prosemirror-tables'
import { dropCursor } from 'prosemirror-dropcursor'
import { GapCursor, gapCursor } from 'prosemirror-gapcursor'
import { isEmptyDocument, nodes, schema } from './schema.ts'
import { toggleBold, toggleCode, toggleItalic } from './commands.ts'
import { parseMarkdown, serializeChapter } from './markdown.ts'
import { imageLayoutPlugin } from './image_layout.ts'
import { figureEditing, newParagraphAtBlock, selectFigureBackward, selectFigureForward } from './figure_editing.ts'

/**
 * 编辑器插件：快捷键、Markdown 输入规则、撤销历史、表格编辑、占位提示、图片布局与剪贴板的 Markdown 文本。
 * 所有章节的 EditorState 共用同一组插件，切换章节时 EditorView 无需重新配置。
 *
 * 键盘写作的原则：任何结构（列表、引用、代码块、表格、图片）都能只用键盘进入和离开；
 * 写作中的 Tab / Shift+Tab 由编辑器处理，不会把焦点移出正文（否则之后输入的文字无处可去）；
 * 要用键盘离开正文时先按 Esc 再按 Tab / Shift+Tab（见 tabAfterEscape）。
 */

const insertHardBreak: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.type.contentMatch.matchType(nodes.hard_break)) return false
  if (dispatch) dispatch(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView())
  return true
}

/** 光标在表格单元格中（单元格只有一行内容）。 */
function inCell(state: EditorState): boolean {
  const role = state.selection.$from.parent.type.spec.tableRole
  return role === 'cell' || role === 'header_cell'
}

/** 光标放在单元格（$cell 指向单元格之前）内容的末尾。 */
function endOfCell(tr: Transaction, $cell: ResolvedPos): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, $cell.pos + $cell.nodeAfter!.nodeSize - 1))
}

/**
 * 单元格中按 Enter：单元格只能有一行，不拆分单元格，而是移到下方的单元格；
 * 已在最后一行时在表格末尾新增一行。
 */
const enterInCell: Command = (state, dispatch) => {
  if (!inCell(state)) return false
  if (!dispatch) return true
  const $cell = selectionCell(state)
  const below = nextCell($cell, 'vert', 1)
  if (below) {
    dispatch(endOfCell(state.tr, below).scrollIntoView())
    return true
  }
  addRowAfter(state, (tr) => {
    const $added = nextCell(tr.doc.resolve(tr.mapping.map($cell.pos)), 'vert', 1)
    dispatch(($added ? endOfCell(tr, $added) : tr).scrollIntoView())
  })
  return true
}

/** 最后一个单元格中按 Tab：在表格末尾新增一行，光标进入新行的第一个单元格。 */
const addRowFromLastCell: Command = (state, dispatch) => {
  if (!isInTable(state)) return false
  if (!dispatch) return true
  const rowEnd = selectionCell(state).after()
  addRowAfter(state, (tr) => {
    const rowStart = tr.mapping.map(rowEnd, -1)
    dispatch(tr.setSelection(TextSelection.create(tr.doc, rowStart + 2)).scrollIntoView())
  })
  return true
}

const CODE_INDENT = '  '

/** 代码块中 Tab 插入两个空格的缩进。 */
const indentInCode: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.type.spec.code) return false
  if (dispatch) dispatch(state.tr.insertText(CODE_INDENT).scrollIntoView())
  return true
}

/** 代码块中 Shift+Tab 去掉光标所在行开头的一级缩进。 */
const outdentInCode: Command = (state, dispatch) => {
  const { $from } = state.selection
  if (!$from.parent.type.spec.code) return false
  const text = $from.parent.textContent
  const lineStart = text.slice(0, $from.parentOffset).lastIndexOf('\n') + 1
  const spaces = /^ {1,2}/.exec(text.slice(lineStart))?.[0].length ?? 0
  if (spaces > 0 && dispatch) {
    const pos = $from.start() + lineStart
    dispatch(state.tr.delete(pos, pos + spaces).scrollIntoView())
  }
  return true
}

/** 其他位置的 Tab / Shift+Tab 不做任何事，但也不让浏览器把焦点移出正文。 */
const keepFocus: Command = () => true

/** 每个视图上一次按下的键（不计单独按下的修饰键），以及当前这次按键是否紧接在 Esc 之后。 */
const lastKey = new WeakMap<EditorView, string>()
const afterEscape = new WeakMap<EditorView, boolean>()

/**
 * 键盘用户离开正文的方式（与 CodeMirror 等编辑器相同）：先按 Esc，再按 Tab / Shift+Tab，
 * 编辑器不处理这次 Tab，焦点按浏览器默认的方式移到下一个 / 上一个控件（如章节树）。
 */
function tabAfterEscape(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return false
        afterEscape.set(view, lastKey.get(view) === 'Escape')
        lastKey.set(view, event.key)
        return false
      },
    },
  })
}

/** Tab / Shift+Tab 的编辑命令；紧接在 Esc 之后时不处理，让焦点离开正文。 */
function unlessAfterEscape(command: Command): Command {
  return (state, dispatch, view) => (view && afterEscape.get(view) ? false : command(state, dispatch, view))
}

/**
 * 在代码块末尾连续两个空行后再按 Enter：去掉这两个空行并离开代码块，在其后新建段落。
 * 代码中间的空行不受影响。
 */
const exitCodeAfterBlankLines: Command = (state, dispatch) => {
  const { $head, empty } = state.selection
  const { parent } = $head
  if (!empty || !parent.type.spec.code || $head.parentOffset !== parent.content.size) return false
  if (!parent.textContent.endsWith('\n\n')) return false
  if (dispatch) {
    const tr = state.tr.delete($head.pos - 2, $head.pos)
    const after = tr.mapping.map($head.after())
    tr.insert(after, nodes.paragraph.create())
    dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView())
  }
  return true
}

/**
 * 代码块之后（之前）没有任何可以放光标的地方时（例如它是章节的最后一个块），
 * 在最后一行按 ↓（第一行按 ↑）在其后（前）新建段落，而不是困在代码块里。
 */
function arrowOutOfCode(dir: 'up' | 'down'): Command {
  return (state, dispatch, view) => {
    const { $head, empty } = state.selection
    if (!empty || !$head.parent.type.spec.code || !view?.endOfTextblock(dir)) return false
    const forward = dir === 'down'
    const edge = forward ? $head.after() : $head.before()
    if (Selection.findFrom(state.doc.resolve(edge), forward ? 1 : -1, true)) return false
    if (dispatch) {
      const tr = state.tr.insert(edge, nodes.paragraph.create())
      dispatch(tr.setSelection(TextSelection.create(tr.doc, edge + 1)).scrollIntoView())
    }
    return true
  }
}

/**
 * 表格是章节（或所在容器）的最后 / 第一个块时，在最后一行按 ↓（第一行按 ↑）把光标移到表格之后（之前）的空隙，
 * 输入即新建段落。表格编辑插件只在最后一列做到这一点：其他列会在同一行内横向移动，看起来出不了表格。
 */
function arrowOutOfTable(dir: 'up' | 'down'): Command {
  return (state, dispatch, view) => {
    if (!state.selection.empty || !inCell(state) || !view?.endOfTextblock(dir)) return false
    const forward = dir === 'down'
    const $cell = selectionCell(state)
    if (nextCell($cell, 'vert', forward ? 1 : -1)) return false
    const edge = forward ? $cell.after(-1) : $cell.before(-1)
    if (Selection.findFrom(state.doc.resolve(edge), forward ? 1 : -1, true)) return false
    if (dispatch) dispatch(state.tr.setSelection(new GapCursor(state.doc.resolve(edge))).scrollIntoView())
    return true
  }
}

/** 标题开头按 Backspace：先变回正文段落（与列表、引用开头按 Backspace 先离开结构一致），再按一次才与上一段合并。 */
const headingToParagraph: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection
  if (!$cursor || $cursor.parentOffset > 0 || $cursor.parent.type !== nodes.heading) return false
  return setBlockType(nodes.paragraph)(state, dispatch)
}

const editingKeymap = keymap({
  // 刚由输入规则转换（如 "- " 变成列表）时，撤销回到转换前的文字，与 Backspace 相同。
  'Mod-z': chainCommands(undoInputRule, undo),
  'Shift-Mod-z': redo,
  'Mod-y': redo,
  Backspace: chainCommands(undoInputRule, headingToParagraph, selectFigureBackward),
  Delete: selectFigureForward,
  'Mod-b': toggleBold,
  'Mod-i': toggleItalic,
  'Mod-e': toggleCode,
  'Alt-ArrowUp': joinUp,
  'Alt-ArrowDown': joinDown,
  Escape: selectParentNode,
  Enter: chainCommands(exitCodeAfterBlankLines, newlineInCode, enterInCell, newParagraphAtBlock, splitListItem(nodes.list_item)),
  'Shift-Enter': chainCommands(exitCode, insertHardBreak),
  'Mod-Enter': chainCommands(exitCode, insertHardBreak),
  ArrowDown: chainCommands(arrowOutOfCode('down'), arrowOutOfTable('down')),
  ArrowUp: chainCommands(arrowOutOfCode('up'), arrowOutOfTable('up')),
  Tab: unlessAfterEscape(
    chainCommands(goToNextCell(1), addRowFromLastCell, sinkListItem(nodes.list_item), indentInCode, keepFocus),
  ),
  'Shift-Tab': unlessAfterEscape(chainCommands(goToNextCell(-1), liftListItem(nodes.list_item), outdentInCode, keepFocus)),
  'Mod-[': liftListItem(nodes.list_item),
  'Mod-]': sinkListItem(nodes.list_item),
})

/** 熟悉 Markdown 的用户可以直接按 Markdown 写法输入块结构。 */
function blockInputRules(): Plugin {
  const rules: InputRule[] = [
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
    wrappingInputRule(
      /^(\d+)\.\s$/,
      nodes.ordered_list,
      (match) => ({ order: Number(match[1]) }),
      (match, node) => node.childCount + node.attrs.order === Number(match[1]),
    ),
    textblockTypeInputRule(/^```$/, nodes.code_block),
    textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (match) => ({ level: match[1].length })),
    horizontalRuleRule(nodes.horizontal_rule),
  ]
  return inputRules({ rules })
}

/** 空段落中输入 --- 变成分隔线，光标进入其后的新段落。 */
function horizontalRuleRule(type: NodeType): InputRule {
  return new InputRule(/^---$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start)
    // 输入最后一个 - 之前，段落中恰好只有 "--"。
    const whole = $start.parentOffset === 0 && $start.parent.content.size === end - start
    if ($start.parent.type !== nodes.paragraph || !whole) return null
    const before = $start.before()
    const tr = state.tr.replaceWith(before, $start.after(), [type.create(), nodes.paragraph.create()])
    return tr.setSelection(TextSelection.create(tr.doc, before + 2)).scrollIntoView()
  })
}

/**
 * 点击章节最后一个块下方的空白处继续写作：最后一块是图片、代码块、表格或分隔线时，
 * 在章节末尾新建段落并把光标放进去（空段落不写入正文）；是普通段落等文字时照常把光标放在末尾。
 */
const CLOSED_BLOCKS: readonly NodeType[] = [nodes.code_block, nodes.table, nodes.horizontal_rule, nodes.figure]

function continueBelow(): Plugin {
  return new Plugin({
    props: {
      handleClick(view, _pos, event) {
        const { doc } = view.state
        const last = doc.lastChild!
        if (!CLOSED_BLOCKS.includes(last.type)) return false
        const dom = view.nodeDOM(doc.content.size - last.nodeSize)
        if (!(dom instanceof HTMLElement) || event.clientY <= dom.getBoundingClientRect().bottom) return false
        const end = doc.content.size
        const tr = view.state.tr.insert(end, nodes.paragraph.create())
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView())
        return true
      },
    },
  })
}

/** 空章节中显示占位提示（不进入文档）。 */
function placeholder(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        if (!isEmptyDocument(state.doc)) return null
        return DecorationSet.create(state.doc, [
          Decoration.node(0, state.doc.firstChild!.nodeSize, { class: 'is-empty', 'data-placeholder': text }),
        ])
      },
    },
  })
}

/**
 * 剪贴板：复制出的纯文本是 Markdown，粘贴的纯文本按 Markdown 解析，
 * 与其他 Markdown 工具之间复制粘贴时结构不丢失。代码块中粘贴的文本仍原样插入（由 ProseMirror 处理）。
 */
function markdownClipboard(): Plugin {
  return new Plugin({
    props: {
      clipboardTextSerializer(slice) {
        const doc = asDocument(slice.content)
        return doc ? serializeChapter(doc).replace(/\n$/, '') : slice.content.textBetween(0, slice.content.size, '\n\n')
      },
      clipboardTextParser(text) {
        const doc = parseMarkdown(text)
        return Slice.maxOpen(doc.content)
      },
      transformPasted: withoutBlankParagraphs,
    },
  })
}

/** 只有空白（包括不换行空格、全角空格）与硬换行的段落。 */
function isBlankParagraph(node: Node): boolean {
  if (node.type !== nodes.paragraph) return false
  let blank = true
  node.forEach((child) => {
    if (child.isText ? /\S/.test(child.text!) : child.type !== nodes.hard_break) blank = false
  })
  return blank
}

/**
 * 网页、Word、WPS 常用空段落（&nbsp;、<br>）制造段间距；它们在 Markdown 中无法保存，粘贴时去掉。
 * 与光标所在段落相接的首尾开放段落保留，粘贴的结构不变。
 */
function withoutBlankParagraphs(slice: Slice): Slice {
  const kept: Node[] = []
  const last = slice.content.childCount - 1
  slice.content.forEach((node, _, index) => {
    const open = (index === 0 && slice.openStart > 0) || (index === last && slice.openEnd > 0)
    if (open || !isBlankParagraph(node)) kept.push(node)
  })
  if (kept.length === 0 || kept.length === slice.content.childCount) return slice
  return new Slice(Fragment.fromArray(kept), slice.openStart, slice.openEnd)
}

/** 片段能直接作为文档（块内容）或段落内容时组成文档；表格局部等其他片段返回 null。 */
function asDocument(content: Fragment): Node | null {
  if (schema.topNodeType.validContent(content)) return schema.topNodeType.create(null, content)
  if (nodes.paragraph.validContent(content)) {
    return schema.topNodeType.create(null, nodes.paragraph.create(null, content))
  }
  return null
}

export const editorPlugins: readonly Plugin[] = [
  tabAfterEscape(),
  blockInputRules(),
  figureEditing(),
  editingKeymap,
  keymap(baseKeymap),
  history(),
  dropCursor({ color: '#2563eb' }),
  gapCursor(),
  tableEditing(),
  placeholder('开始写作…'),
  continueBelow(),
  imageLayoutPlugin(),
  markdownClipboard(),
]

export function createEditorState(doc: Node): EditorState {
  return EditorState.create({ doc, plugins: [...editorPlugins] })
}
