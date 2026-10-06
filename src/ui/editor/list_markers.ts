import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { DEFAULT_LIST_NUMBERING, formatListMarker, isListNumbering } from '../../domain/list_numbering/list_numbering.ts'
import { nodes } from './schema.ts'

/**
 * 有序列表的编号样式（docs/decisions.md 第 24 节）：默认的 `1.` 由浏览器画出；其他样式的编号文字
 * （domain/list_numbering，与导出相同）写在列表项的 data-marker 中，由 document_body.css 显示。
 * 任务项显示复选框，没有编号（与默认样式相同）。
 */
export function listMarkers(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.isTextblock) return false
          if (node.type !== nodes.ordered_list || node.attrs.numbering === DEFAULT_LIST_NUMBERING) return true
          node.forEach((item, offset, index) => {
            if (item.attrs.checked !== null) return
            const marker = formatListMarker(node.attrs.numbering, (node.attrs.order as number) + index)
            const from = pos + 1 + offset
            decorations.push(Decoration.node(from, from + item.nodeSize, { 'data-marker': marker }))
          })
          return true
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}

/** 只读展示（全文阅读）的 DOM 中，给有编号样式的列表各项写上编号文字，与编辑器相同。 */
export function applyListMarkers(root: ParentNode): void {
  for (const list of root.querySelectorAll('ol[data-numbering]')) {
    const numbering = list.getAttribute('data-numbering')
    if (!isListNumbering(numbering)) continue
    const start = list.hasAttribute('start') ? Number(list.getAttribute('start')) : 1
    Array.from(list.children).forEach((item, index) => {
      if (item.tagName === 'LI' && !item.hasAttribute('data-task')) {
        item.setAttribute('data-marker', formatListMarker(numbering, start + index))
      }
    })
  }
}
