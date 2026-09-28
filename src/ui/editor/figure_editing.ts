import type { Node, ResolvedPos } from 'prosemirror-model'
import { NodeSelection, Plugin, TextSelection, type Command } from 'prosemirror-state'
import { GapCursor } from 'prosemirror-gapcursor'
import { nodes } from './schema.ts'

/**
 * 独立成段的图片（figure 节点）的编辑。
 *
 * figure 是块级原子节点：光标不能停在图片旁边，文字（包括输入法组字）只会进入图片之前 / 之后的段落。
 * 选中、方向键进出（包括图片是章节第一 / 最后一块时停在它之前 / 之后的空隙）由 ProseMirror 与 gapcursor 处理，
 * 这里只补充：
 * - 选中图片、或光标在块之间的空隙时按 Enter：在图片之后（空隙处）新建段落；
 * - 图片后一段的段首按 Backspace（或图片前一段的段尾按 Delete）先选中图片，再按一次才删除；
 *   这一段是空段落时同时删掉它（ProseMirror 默认会直接删掉图片）；
 * - 编辑使某个段落只剩一张图片时（删掉图片旁的文字、粘贴只含图片的段落），它成为 figure，与预览 / 导出一致。
 */

/** 选中图片时在其后、光标在块之间的空隙时在空隙处新建段落。 */
export const newParagraphAtBlock: Command = (state, dispatch) => {
  const { selection } = state
  let pos: number
  if (selection instanceof NodeSelection && selection.node.type === nodes.figure) pos = selection.to
  else if (selection instanceof GapCursor) pos = selection.from
  else return false
  if (dispatch) {
    const tr = state.tr.insert(pos, nodes.paragraph.create())
    dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView())
  }
  return true
}

/** 与光标所在文本块相邻（dir = -1 之前，1 之后）的 figure 的位置；没有则为 null。 */
function adjacentFigure($cursor: ResolvedPos, dir: -1 | 1): number | null {
  const parent = $cursor.node(-1)
  const index = $cursor.index(-1) + dir
  if (index < 0 || index >= parent.childCount) return null
  const sibling = parent.child(index)
  if (sibling.type !== nodes.figure) return null
  return dir < 0 ? $cursor.before() - sibling.nodeSize : $cursor.after()
}

function selectAdjacentFigure(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { $cursor } = state.selection as TextSelection
    if (!$cursor || !$cursor.parent.isTextblock) return false
    const atEdge = dir < 0 ? $cursor.parentOffset === 0 : $cursor.parentOffset === $cursor.parent.content.size
    if (!atEdge) return false
    const figure = adjacentFigure($cursor, dir)
    if (figure === null) return false
    if (dispatch) {
      const tr = state.tr
      if ($cursor.parent.content.size === 0) tr.delete($cursor.before(), $cursor.after())
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, tr.mapping.map(figure))).scrollIntoView())
    }
    return true
  }
}

export const selectFigureBackward = selectAdjacentFigure(-1)
export const selectFigureForward = selectAdjacentFigure(1)

/**
 * 段落中唯一的内容是一张（不带链接的）图片时返回这张图片：其余只有空格、制表符与硬换行，
 * 写成 Markdown 时它们都会被去掉，段落就是独立成段的图。
 */
function soleImage(node: Node): Node | null {
  if (node.type !== nodes.paragraph) return null
  let image: Node | null = null
  let other = false
  node.forEach((child) => {
    if (child.type === nodes.image && image === null && child.marks.length === 0) image = child
    else if (child.isText ? /[^ \t]/.test(child.text!) : child.type !== nodes.hard_break) other = true
  })
  return other ? null : image
}

export function figureEditing(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, state) {
      // 输入法组字中途不改动文档；组字结束后的下一次修改会补上。
      if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta('composition') !== undefined)) {
        return null
      }
      const found: Array<{ pos: number; node: Node; image: Node }> = []
      state.doc.descendants((node, pos) => {
        const image = soleImage(node)
        if (image) found.push({ pos, node, image })
        return !node.isTextblock
      })
      if (found.length === 0) return null
      const { selection } = state
      const tr = state.tr
      for (const { pos, node, image } of found) {
        const from = tr.mapping.map(pos)
        tr.replaceWith(from, from + node.nodeSize, nodes.figure.create(image.attrs))
        // 光标或选区原本在这个段落里：选中这张图片（光标不能停在图片旁边）。
        if (selection.from >= pos && selection.to <= pos + node.nodeSize) {
          tr.setSelection(NodeSelection.create(tr.doc, from))
        }
      }
      return tr
    },
  })
}
