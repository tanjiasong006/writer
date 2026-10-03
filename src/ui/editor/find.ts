import type { Node } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

/**
 * 正文中的查找与替换（ProseMirror 文档上的纯函数）。
 *
 * - 在每个文字块（段落、代码块、表格单元格……）内查找，可以跨过粗体等格式的边界，不跨块。
 *   章节引用、行内图片与换行是一个不可分割的位置，不会与文字一起匹配。
 * - 拉丁字母不区分大小写；其余字符（含全角 / 半角）原样比较。
 * - 匹配互不重叠，按文档顺序排列。图注（图片的属性）与章节标题不在正文文字中，不参与查找。
 * - 替换是普通的正文事务：进入撤销历史，按替换处原有的格式写入新文字。
 */

export interface FindMatch {
  readonly from: number
  readonly to: number
}

/** 非文字的行内节点在查找文本中的占位：不会与任何查找词匹配。 */
const ATOM = '￼'

/** 不区分大小写的比较形式；转小写会改变长度的少数字符原样比较，位置仍一一对应。 */
function fold(text: string): string {
  const lower = text.toLowerCase()
  return lower.length === text.length ? lower : text
}

/** doc 中 query 的全部匹配。query 为空时没有匹配。 */
export function findMatches(doc: Node, query: string): FindMatch[] {
  if (query === '') return []
  const needle = fold(query)
  const matches: FindMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      text += child.isText ? child.text! : ATOM
    })
    const haystack = fold(text)
    const start = pos + 1
    let index = haystack.indexOf(needle)
    while (index >= 0) {
      matches.push({ from: start + index, to: start + index + needle.length })
      index = haystack.indexOf(needle, index + needle.length)
    }
    return false
  })
  return matches
}

/** 选区之后的第一个匹配（选区本身是匹配时是下一个）；没有时为 -1。 */
export function nextMatchIndex(matches: readonly FindMatch[], selection: FindMatch): number {
  return matches.findIndex((match) => match.from >= selection.to)
}

/** 选区之前的最后一个匹配；没有时为 -1。 */
export function previousMatchIndex(matches: readonly FindMatch[], selection: FindMatch): number {
  for (let index = matches.length - 1; index >= 0; index--) {
    if (matches[index].to <= selection.from) return index
  }
  return -1
}

/** 恰好是选区的匹配；没有时为 -1。 */
export function selectedMatchIndex(matches: readonly FindMatch[], selection: FindMatch): number {
  return matches.findIndex((match) => match.from === selection.from && match.to === selection.to)
}

/** 把这些匹配替换为 replacement 的事务（从后往前替换，前面的位置不受影响）。 */
export function replaceMatches(state: EditorState, matches: readonly FindMatch[], replacement: string): Transaction {
  const tr = state.tr
  for (let index = matches.length - 1; index >= 0; index--) {
    const { from, to } = matches[index]
    if (replacement === '') tr.delete(from, to)
    else tr.insertText(replacement, from, to)
  }
  return tr
}

/** 匹配处的高亮（不进入文档）；与选区相同的匹配是当前匹配。 */
export function findDecorations(doc: Node, matches: readonly FindMatch[], selection: FindMatch): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    matches.map((match) =>
      Decoration.inline(match.from, match.to, {
        class: match.from === selection.from && match.to === selection.to ? 'find-match is-current' : 'find-match',
      }),
    ),
  )
}
