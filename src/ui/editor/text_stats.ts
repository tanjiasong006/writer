import type { Node } from 'prosemirror-model'
import { countText, type TextCount } from '../../domain/word_count/word_count.ts'
import { nodes } from './schema.ts'
import type { ChapterRefLabel } from './chapter_ref_view.ts'

/**
 * 正文的字数（domain/word_count 的规则）：按看到的文字计算，不计 Markdown 记号。
 *
 * - 图注（独立图片的替代文字）计入，行内图片不计；章节引用按显示的文字计入（失效时是链接文字）。
 * - 块与块之间、换行处按空白分开，西文单词不会跨块连在一起。
 * - 章节标题不在正文中，不计入。
 */
export function textOf(doc: Node, from: number, to: number, refLabel: ChapterRefLabel): string {
  return doc.textBetween(from, to, '\n', (leaf) => {
    if (leaf.type === nodes.figure) return `\n${leaf.attrs.alt as string}\n`
    if (leaf.type === nodes.chapter_ref) return refLabel(leaf.attrs.href as string)?.text ?? (leaf.attrs.cached as string)
    if (leaf.type === nodes.hard_break) return '\n'
    return ' '
  })
}

/** 整个文档的字数。 */
export function countDoc(doc: Node, refLabel: ChapterRefLabel): TextCount {
  return countText(textOf(doc, 0, doc.content.size, refLabel))
}

/** 选区中的字数；空选区为 null。 */
export function countSelection(doc: Node, from: number, to: number, refLabel: ChapterRefLabel): TextCount | null {
  return from === to ? null : countText(textOf(doc, from, to, refLabel))
}
