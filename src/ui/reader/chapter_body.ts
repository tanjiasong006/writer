import { DOMSerializer } from 'prosemirror-model'
import { parseChapter } from '../editor/markdown.ts'
import { schema } from '../editor/schema.ts'
import { highlightedCodeDOM } from '../editor/code_highlight.ts'
import { staticImageDOM, type ImageResolver } from '../editor/image_view.ts'

/**
 * 章节正文 → 只读展示的 DOM：与编辑器使用同一个 Markdown 解析与 schema，
 * 图片与代码块与编辑器中的结构相同（staticImageDOM、highlightedCodeDOM），样式因此完全一致（editor/document_body.css）。
 * 每个顶层块对应一个元素，按顺序排列（阅读位置按块序号对齐，见 editor/block_position.ts）。
 */
export function renderChapterBody(text: string, resolveImage: ImageResolver): DocumentFragment {
  const base = DOMSerializer.fromSchema(schema)
  const serializer = new DOMSerializer(
    {
      ...base.nodes,
      figure: (node) => staticImageDOM(node, resolveImage),
      image: (node) => staticImageDOM(node, resolveImage),
      code_block: (node) => highlightedCodeDOM(node),
    },
    base.marks,
  )
  return serializer.serializeFragment(parseChapter(text).doc.content) as DocumentFragment
}
