import type { Node } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { nodes } from './schema.ts'

/**
 * 脚注的显示（不进入文档）：
 * - 正文中的脚注是上标编号，按在章节中的顺序编号（decoration 给出 data-number，CSS 显示）；
 * - 章节末尾列出全部脚注（编号与内容），单击一条编辑它（由 ChapterEditor 处理 data-footnote-pos）。
 * 编号只是显示：Word / PDF 中脚注在全文中连续编号。
 */

/** 文档中全部脚注的位置与节点，按顺序。 */
export function footnotesOf(doc: Node): Array<{ readonly pos: number; readonly node: Node }> {
  const found: Array<{ pos: number; node: Node }> = []
  doc.descendants((node, pos) => {
    if (node.type === nodes.footnote) found.push({ pos, node })
    return node.type !== nodes.footnote
  })
  return found
}

/** pos 处脚注的编号（从 1 开始）；不是脚注时为 0。 */
export function footnoteNumber(doc: Node, pos: number): number {
  return footnotesOf(doc).findIndex((note) => note.pos === pos) + 1
}

/** 章节末尾的脚注列表（编辑器与全文阅读共用）。pos 为 null 时不可单击（全文阅读）。 */
export function footnoteListDOM(notes: ReadonlyArray<{ readonly pos: number | null; readonly text: string }>): HTMLElement {
  const list = document.createElement('ol')
  list.className = 'document-footnotes'
  list.contentEditable = 'false'
  list.setAttribute('aria-label', '脚注')
  for (const note of notes) {
    const item = document.createElement('li')
    if (note.pos !== null) item.dataset.footnotePos = String(note.pos)
    item.textContent = note.text.trim() === '' ? '（空脚注）' : note.text
    item.classList.toggle('is-empty', note.text.trim() === '')
    list.append(item)
  }
  return list
}

export function footnoteDisplay(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const notes = footnotesOf(state.doc)
        if (notes.length === 0) return null
        const decorations = notes.map(({ pos, node }, index) =>
          Decoration.node(pos, pos + node.nodeSize, { 'data-number': String(index + 1) }),
        )
        const items = notes.map(({ pos, node }) => ({ pos, text: node.attrs.text as string }))
        decorations.push(
          Decoration.widget(state.doc.content.size, () => footnoteListDOM(items), {
            side: 1,
            key: `footnotes:${JSON.stringify(items)}`,
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        )
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}
