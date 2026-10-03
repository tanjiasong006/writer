import {
  DOMParser,
  Fragment,
  Schema,
  type DOMOutputSpec,
  type Mark,
  type Node,
  type NodeSpec,
  type TagParseRule,
} from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'

/**
 * 正文结构的权威定义。
 *
 * 只包含正文持久化格式（Markdown，docs/decisions.md 第 2 节）能表达、且导出
 * （Rust pulldown-cmark）能渲染的结构：段落、引用、列表（含任务列表标记）、代码块、
 * 分隔线、表格、图片（独占一段的 figure 与行内图片）、硬换行、章节引用，以及粗体、斜体、删除线、行内代码、链接。
 * 不能用 Markdown 表达的结构（合并单元格、单元格内多段落等）不进入 schema。
 * 正文不支持标题与 HTML（docs/decisions.md 第 8 节）：结构由章节树表达，Markdown 中的标题与 HTML 都是文字。
 */

type Align = 'left' | 'center' | 'right'

function parseAlign(value: string | null | undefined): Align | null {
  return value === 'left' || value === 'center' || value === 'right' ? value : null
}

const table = tableNodes({
  tableGroup: 'block',
  // GFM 表格的单元格只能是一行行内内容：不允许硬换行与块级内容。
  cellContent: '(text | image | chapter_ref | footnote)*',
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (dom) => parseAlign(dom.style.textAlign || dom.getAttribute('align')),
      setDOMAttr: (value, attrs) => {
        if (value) attrs.style = `${typeof attrs.style === 'string' ? attrs.style : ''}text-align: ${value};`
      },
    },
  },
})

/**
 * 粘贴的单元格可能含多段或其他块（Word、WPS 总是用 <p> 包裹单元格内容）：
 * 压成单元格能容纳的一行行内内容，块与硬换行之间用空格连接，文字与格式保留。
 */
function inlineCellContent(dom: HTMLElement | globalThis.Node, schema: Schema): Fragment {
  const parsed = DOMParser.fromSchema(schema).parseSlice(dom).content
  const parts: Node[] = []
  let space = false
  const push = (node: Node) => {
    if (space && parts.length > 0) parts.push(schema.text(' '))
    space = false
    parts.push(node)
  }
  parsed.descendants((node) => {
    if (node.isText || node.type === schema.nodes.image || node.type === schema.nodes.chapter_ref) push(node)
    else if (node.type === schema.nodes.figure) push(schema.nodes.image.create(node.attrs))
    else if (node.isBlock || node.type === schema.nodes.hard_break) space = true
    return !node.isText
  })
  return Fragment.fromArray(parts)
}

function withInlineCellContent(spec: NodeSpec): NodeSpec {
  const rules = (spec.parseDOM ?? []) as readonly TagParseRule[]
  return { ...spec, parseDOM: rules.map((rule) => ({ ...rule, getContent: inlineCellContent })) }
}

/**
 * 只接受正文中的相对引用（如 ../assets/图.png）作为图片。图片只能经"插入图片"导入项目资源；
 * 粘贴进来的远程地址、本机临时文件（file:）与内嵌数据（data:）不进入正文。
 */
function isContentReference(src: string): boolean {
  return src.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[\\/]/.test(src)
}

const imageAttrs = {
  /** 正文中的原始引用（如 ../assets/图.png），不做任何改写。 */
  src: { validate: 'string' },
  alt: { default: '', validate: 'string' },
  title: { default: null, validate: 'string|null' },
}

function imageDOMAttrs(dom: HTMLElement): { src: string; alt: string; title: string | null } | false {
  const src = dom.getAttribute('src') ?? ''
  if (!isContentReference(src)) return false
  return { src, alt: dom.getAttribute('alt') ?? '', title: dom.getAttribute('title') }
}

function imageOutputAttrs(node: Node): Record<string, string | null> {
  return { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }
}

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    paragraph: {
      content: 'inline*',
      group: 'block',
      parseDOM: [{ tag: 'p' }],
      toDOM: (): DOMOutputSpec => ['p', 0],
    },

    blockquote: {
      content: 'block+',
      group: 'block',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: (): DOMOutputSpec => ['blockquote', 0],
    },

    code_block: {
      attrs: { params: { default: '', validate: 'string' } },
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      parseDOM: [
        {
          tag: 'pre',
          preserveWhitespace: 'full',
          getAttrs: (dom) => ({ params: dom.getAttribute('data-params') ?? '' }),
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        'pre',
        node.attrs.params ? { 'data-params': node.attrs.params } : {},
        ['code', 0],
      ],
    },

    horizontal_rule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
      toDOM: (): DOMOutputSpec => ['hr'],
    },

    bullet_list: {
      attrs: { tight: { default: true, validate: 'boolean' } },
      content: 'list_item+',
      group: 'block',
      parseDOM: [{ tag: 'ul', getAttrs: (dom) => ({ tight: !dom.hasAttribute('data-loose') }) }],
      toDOM: (node): DOMOutputSpec => ['ul', node.attrs.tight ? {} : { 'data-loose': '' }, 0],
    },

    ordered_list: {
      attrs: {
        order: { default: 1, validate: 'number' },
        tight: { default: true, validate: 'boolean' },
      },
      content: 'list_item+',
      group: 'block',
      parseDOM: [
        {
          tag: 'ol',
          getAttrs: (dom) => ({
            order: dom.hasAttribute('start') ? Number(dom.getAttribute('start')) || 1 : 1,
            tight: !dom.hasAttribute('data-loose'),
          }),
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        'ol',
        { ...(node.attrs.order === 1 ? {} : { start: node.attrs.order }), ...(node.attrs.tight ? {} : { 'data-loose': '' }) },
        0,
      ],
    },

    list_item: {
      /** GFM 任务列表标记：null 表示普通列表项。 */
      attrs: { checked: { default: null, validate: 'boolean|null' } },
      content: 'block+',
      defining: true,
      parseDOM: [
        {
          tag: 'li',
          getAttrs: (dom) => {
            const task = dom.getAttribute('data-task')
            return { checked: task === 'done' ? true : task === 'todo' ? false : null }
          },
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        'li',
        node.attrs.checked === null ? {} : { 'data-task': node.attrs.checked ? 'done' : 'todo' },
        0,
      ],
    },

    ...table,
    // 单元格只有一行行内内容（是文本块），gapcursor 会把"两个单元格之间"当成可放光标的位置，
    // 导致方向键无法离开首尾的表格。行内不允许 gapcursor，光标才能移到表格之前 / 之后。
    table_row: { ...table.table_row, allowGapCursor: false },
    table_cell: withInlineCellContent(table.table_cell),
    table_header: withInlineCellContent(table.table_header),

    text: { group: 'inline' },

    /**
     * 独占一段的图片（Markdown 中单独成段的 ![alt](src)）：块级、原子节点，与导出中的图（figure）对应，
     * alt 是它的图注。它是一个整体：光标只能在它之前 / 之后的段落中，不能停在图片旁边。
     */
    figure: {
      attrs: imageAttrs,
      group: 'block',
      atom: true,
      draggable: true,
      parseDOM: [
        {
          tag: 'figure',
          getAttrs: (dom) => {
            const image = dom.querySelector('img')
            return image ? imageDOMAttrs(image) : false
          },
        },
      ],
      toDOM: (node): DOMOutputSpec => ['figure', ['img', imageOutputAttrs(node)]],
    },

    /** 行内图片：与文字同处一段（或在表格单元格、标题中）的图片。 */
    image: {
      inline: true,
      attrs: imageAttrs,
      group: 'inline',
      draggable: true,
      parseDOM: [{ tag: 'img[src]', getAttrs: imageDOMAttrs }],
      toDOM: (node): DOMOutputSpec => ['img', imageOutputAttrs(node)],
    },

    /**
     * 章节交叉引用（docs/decisions.md 第 9 节）：Markdown 中是地址为 `writer:chapter/…` 的链接。
     * 行内的原子节点：整体选中、删除，文字不能编辑。href 是原样写回的地址（格式错误的也保留）；
     * cached 是 Markdown 中的链接文字，只是缓存，目标失效时用来提示原来的目标。
     * 可以带粗体等强调；链接与行内代码无法在 Markdown 中包裹它，写出时去掉（见 markdown.ts）。
     */
    chapter_ref: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: {
        href: { validate: 'string' },
        cached: { default: '', validate: 'string' },
      },
      leafText: (node) => node.attrs.cached as string,
      parseDOM: [
        {
          tag: 'span[data-chapter-ref]',
          getAttrs: (dom) => ({ href: dom.getAttribute('data-chapter-ref'), cached: dom.textContent ?? '' }),
        },
        // 从其他地方粘贴的、地址是引用的链接。
        {
          tag: 'a[href^="writer:"]',
          priority: 60,
          getAttrs: (dom) => ({ href: dom.getAttribute('href'), cached: dom.textContent ?? '' }),
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        'span',
        { class: 'chapter-ref', 'data-chapter-ref': node.attrs.href },
        node.attrs.cached,
      ],
    },

    /**
     * 脚注（Markdown 中的 `[^1]` 与章节末尾的 `[^1]: 内容`）：行内的原子节点，显示为上标的编号（按章节中的顺序，
     * 由 decoration 给出，不存进文档）。text 是脚注内容的文字；source 是载入时定义的 Markdown 原文
     * （可能带格式或多行），内容没有修改时原样写回，修改后按 text 写出。
     */
    footnote: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: {
        text: { default: '', validate: 'string' },
        source: { default: null, validate: 'string|null' },
      },
      leafText: () => '',
      parseDOM: [
        {
          tag: 'sup[data-footnote]',
          getAttrs: (dom) => ({ text: dom.getAttribute('data-footnote') ?? '' }),
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        'sup',
        { class: 'footnote-ref', 'data-footnote': node.attrs.text, title: node.attrs.text },
      ],
    },

    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      // 段落与代码块互转时，硬换行与代码中的换行符相互替换。
      linebreakReplacement: true,
      parseDOM: [{ tag: 'br' }],
      toDOM: (): DOMOutputSpec => ['br'],
    },
  },

  // 顺序即嵌套顺序：链接在外，行内代码在最内层。
  marks: {
    link: {
      attrs: {
        href: { validate: 'string' },
        title: { default: null, validate: 'string|null' },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs: (dom) => ({ href: dom.getAttribute('href'), title: dom.getAttribute('title') }),
        },
      ],
      // 编辑器中不输出 href：正文里的链接不应被点击打开（包括 javascript: 等地址）。
      toDOM: (mark: Mark): DOMOutputSpec => [
        'a',
        { 'data-href': mark.attrs.href, title: mark.attrs.title ?? mark.attrs.href },
        0,
      ],
    },

    strong: {
      parseDOM: [
        { tag: 'strong' },
        // Google Docs 等会用 <b style="font-weight: normal"> 包裹普通文本。
        { tag: 'b', getAttrs: (dom) => dom.style.fontWeight !== 'normal' && null },
        {
          style: 'font-weight',
          getAttrs: (value) => /^(bold(er)?|[6-9]\d{2,})$/.test(value) && null,
        },
      ],
      toDOM: (): DOMOutputSpec => ['strong', 0],
    },

    em: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
      toDOM: (): DOMOutputSpec => ['em', 0],
    },

    strike: {
      parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }],
      toDOM: (): DOMOutputSpec => ['s', 0],
    },

    code: {
      code: true,
      parseDOM: [{ tag: 'code' }],
      toDOM: (): DOMOutputSpec => ['code', 0],
    },
  },
})

export const nodes = schema.nodes
export const marks = schema.marks

/** 文档是否只有一个空段落（新章节或清空后的章节）。 */
export function isEmptyDocument(doc: Node): boolean {
  return doc.childCount === 1 && doc.firstChild!.type === nodes.paragraph && doc.firstChild!.content.size === 0
}
