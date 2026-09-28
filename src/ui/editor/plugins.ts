import { Slice, type Fragment, type Node, type NodeType, type ResolvedPos } from 'prosemirror-model'
import { EditorState, Plugin, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import {
  baseKeymap,
  chainCommands,
  exitCode,
  joinDown,
  joinUp,
  newlineInCode,
  selectParentNode,
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
import { addRowAfter, goToNextCell, nextCell, selectionCell, tableEditing } from 'prosemirror-tables'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { isEmptyDocument, nodes, schema } from './schema.ts'
import { toggleBold, toggleCode, toggleItalic } from './commands.ts'
import { parseMarkdown, serializeChapter } from './markdown.ts'
import { imageLayoutPlugin } from './image_layout.ts'

/**
 * 编辑器插件：快捷键、Markdown 输入规则、撤销历史、表格编辑、占位提示、图片布局与剪贴板的 Markdown 文本。
 * 所有章节的 EditorState 共用同一组插件，切换章节时 EditorView 无需重新配置。
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

const editingKeymap = keymap({
  'Mod-z': undo,
  'Shift-Mod-z': redo,
  'Mod-y': redo,
  Backspace: undoInputRule,
  'Mod-b': toggleBold,
  'Mod-i': toggleItalic,
  'Mod-e': toggleCode,
  'Alt-ArrowUp': joinUp,
  'Alt-ArrowDown': joinDown,
  Escape: selectParentNode,
  Enter: chainCommands(newlineInCode, enterInCell, splitListItem(nodes.list_item)),
  'Shift-Enter': chainCommands(exitCode, insertHardBreak),
  'Mod-Enter': chainCommands(exitCode, insertHardBreak),
  Tab: chainCommands(goToNextCell(1), sinkListItem(nodes.list_item)),
  'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(nodes.list_item)),
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
    },
  })
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
  blockInputRules(),
  editingKeymap,
  keymap(baseKeymap),
  history(),
  dropCursor({ color: '#2563eb' }),
  gapCursor(),
  tableEditing(),
  placeholder('开始写作…'),
  imageLayoutPlugin(),
  markdownClipboard(),
]

export function createEditorState(doc: Node): EditorState {
  return EditorState.create({ doc, plugins: [...editorPlugins] })
}
