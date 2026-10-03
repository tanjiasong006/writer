import { DOMSerializer, type Node } from 'prosemirror-model'
import { chapterLabels, type ElementStart } from '../editor/element_numbering.ts'
import { parseChapter } from '../editor/markdown.ts'
import { schema } from '../editor/schema.ts'
import { highlightedCodeDOM } from '../editor/code_highlight.ts'
import { staticImageDOM, type ImageResolver } from '../editor/image_view.ts'
import { staticChapterRefDOM, type ChapterRefLabel } from '../editor/chapter_ref_view.ts'
import { footnoteListDOM, footnotesOf } from '../editor/footnote_view.ts'

/**
 * 章节正文 → 只读展示的 DOM：与编辑器使用同一个 Markdown 解析与 schema，
 * 图片与代码块与编辑器中的结构相同（staticImageDOM、highlightedCodeDOM），样式因此完全一致（editor/document_body.css）。
 * 章节引用的文字按 refLabel（当前章节树）生成，与编辑器相同。
 * 每个顶层块对应一个元素，按顺序排列（阅读位置按块序号对齐，见 editor/block_position.ts）。
 */
export function renderChapterBody(
  text: string,
  resolveImage: ImageResolver,
  refLabel: ChapterRefLabel,
  /** 本章图表编号的起点；不提供时不显示编号。 */
  elementStart: ElementStart | null = null,
): DocumentFragment {
  const { doc } = parseChapter(text)
  // 图表编号（与编辑器相同）：序列化按文档顺序进行，按同样的顺序取用编号。
  const labels = elementStart ? [...chapterLabels(doc, elementStart).values()] : []
  const caption = (node: Node) =>
    (node.type === schema.nodes.figure ? (node.attrs.alt as string) : ((node.attrs.caption as string | null) ?? '')).trim()
  const nextLabel = (node: Node) => (caption(node) === '' ? null : (labels.shift() ?? null))
  const base = DOMSerializer.fromSchema(schema)
  const serializer = new DOMSerializer(
    {
      ...base.nodes,
      figure: (node) => staticImageDOM(node, resolveImage, nextLabel(node)),
      table: (node) => {
        const label = nextLabel(node)
        const table = document.createElement('table')
        const body = document.createElement('tbody')
        table.append(body)
        if (label === null) return { dom: table, contentDOM: body }
        const wrapper = document.createElement('div')
        const title = document.createElement('div')
        title.className = 'table-caption'
        const number = document.createElement('span')
        number.className = 'table-caption__label'
        number.textContent = label
        title.append(number, caption(node))
        wrapper.append(title, table)
        return { dom: wrapper, contentDOM: body }
      },
      image: (node) => staticImageDOM(node, resolveImage),
      code_block: (node) => highlightedCodeDOM(node),
      chapter_ref: (node) => staticChapterRefDOM(node, refLabel),
    },
    base.marks,
  )
  const fragment = serializer.serializeFragment(doc.content) as DocumentFragment
  // 脚注：正文中按顺序编号，章节末尾列出内容（与编辑器相同）。列表不是正文的块，不参与按块对齐的阅读位置。
  const notes = footnotesOf(doc)
  if (notes.length > 0) {
    fragment.querySelectorAll('.footnote-ref').forEach((ref, index) => ref.setAttribute('data-number', String(index + 1)))
    const list = footnoteListDOM(notes.map(({ node }) => ({ pos: null, text: node.attrs.text as string })))
    fragment.append(list)
  }
  return fragment
}
