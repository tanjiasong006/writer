import MarkdownIt from 'markdown-it'
import { Fragment, type MarkType, type Node } from 'prosemirror-model'
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownSerializer,
  type MarkdownSerializerState,
} from 'prosemirror-markdown'
import { marks, nodes, schema } from './schema.ts'

/**
 * 正文持久化格式（Markdown）与编辑器文档之间的转换。
 *
 * Markdown 方言与预览 / 导出使用的 Rust pulldown-cmark 保持一致：CommonMark + GFM 表格、删除线、任务列表；
 * 原始 HTML 一律视为文字。序列化结果再次解析后结构不变（round trip），见 markdown.test.ts。
 */

type Token = ReturnType<MarkdownIt['parse']>[number]

/** 行尾、结尾换行与 BOM：编辑后写回时保持原文件的风格。 */
export interface TextFormat {
  readonly crlf: boolean
  readonly bom: boolean
  /** 非空正文是否以换行结尾（空章节写入内容后以换行结尾）。 */
  readonly finalNewline: boolean
}

const DEFAULT_FORMAT: TextFormat = { crlf: false, bom: false, finalNewline: true }

export interface ParsedChapter {
  readonly doc: Node
  readonly format: TextFormat
}

/** 把章节正文解析为编辑器文档。任何输入都能解析，不会抛出。 */
export function parseChapter(text: string): ParsedChapter {
  const bom = text.startsWith('\uFEFF')
  const body = bom ? text.slice(1) : text
  const format = { crlf: usesOnlyCrlf(body), bom, finalNewline: body.length === 0 || /\n$/.test(body) }
  return { doc: parser.parse(body), format }
}

/** 把编辑器文档写成章节正文。 */
export function serializeChapter(doc: Node, format: TextFormat = DEFAULT_FORMAT): string {
  const markdown = serializeMarkdown(doc)
  const body = markdown.length > 0 && format.finalNewline ? `${markdown}\n` : markdown
  return (format.bom ? '\uFEFF' : '') + (format.crlf ? body.replaceAll('\n', '\r\n') : body)
}

/** 文件全部使用 \r\n 换行时为 true；混合换行编辑后统一为 \n。 */
function usesOnlyCrlf(text: string): boolean {
  return text.includes('\r\n') && !/[\r\n]/.test(text.replaceAll('\r\n', ''))
}

// ---------------------------------------------------------------------------
// Markdown → 文档

/** 与 Rust 渲染器相同：块级嵌套超过此深度的内容无法表示（pulldown-cmark 一侧在 32 层压平）。 */
const MAX_NESTING = 100

const tokenizer = MarkdownIt('commonmark', { html: false }).enable(['table', 'strikethrough'])
// commonmark 预设只允许 20 层；maxNesting 是 markdown-it 的运行时选项，类型定义中没有列出。
Object.assign(tokenizer.options, { maxNesting: MAX_NESTING })
// 保留链接与图片地址的原文：不做百分号编码，也不因协议拒绝（导出时由 Rust 决定是否可用）。
tokenizer.normalizeLink = (url) => url
tokenizer.normalizeLinkText = (url) => url
tokenizer.validateLink = () => true

tokenizer.core.ruler.push('writer_soft_break', (state) => {
  for (const token of state.tokens) {
    if (token.type === 'inline' && token.children) joinSoftBreaks(token.children)
  }
})

tokenizer.core.ruler.push('writer_task_list', (state) => {
  const tokens = state.tokens
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i].type !== 'list_item_open' || tokens[i + 1].type !== 'paragraph_open') continue
    const inline = tokens[i + 2]
    const first = inline.children?.[0]
    const marker = /^\[([ xX])\](?:[ \t]+|$)/
    // 以原文判断，避免把转义过的 \[ ] 当成任务标记。
    const source = marker.exec(inline.content)
    const text = first?.type === 'text' ? marker.exec(first.content) : null
    if (!source || !text || !first) continue
    first.content = first.content.slice(text[0].length)
    tokens[i].meta = { checked: source[1] !== ' ' }
  }
})

/**
 * 只含一张图片的段落是独立的图（figure），与预览 / 导出的判断相同：把 paragraph_open、inline（只有一张图片）、
 * paragraph_close 合成一个 figure 记号。任务列表标记去掉后留下的空文字不算内容。图片与文字同处一段时仍是段落。
 */
tokenizer.core.ruler.push('writer_figure', (state) => {
  const tokens = state.tokens
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i].type !== 'paragraph_open' || tokens[i + 2].type !== 'paragraph_close') continue
    const content = (tokens[i + 1].children ?? []).filter((child) => !(child.type === 'text' && child.content === ''))
    if (content.length !== 1 || content[0].type !== 'image') continue
    const figure = new state.Token('figure', '', 0)
    figure.attrs = content[0].attrs
    figure.children = content[0].children
    figure.map = tokens[i].map
    // 紧凑列表的判断读取列表项第一个记号的 hidden（见 listIsTight）。
    figure.hidden = tokens[i].hidden
    tokens.splice(i, 3, figure)
  }
})

/**
 * 软换行（源文件中段落内的折行）按渲染结果处理：一般是空格；
 * 两侧都是中文时什么都没有——与 Rust 渲染器去掉中文之间软换行的规则一致。
 */
function joinSoftBreaks(children: Token[]): void {
  children.forEach((token, index) => {
    if (token.type !== 'softbreak') return
    const before = children[index - 1]
    const after = children[index + 1]
    const cjk =
      before?.type === 'text' && after?.type === 'text' && isCjk(before.content.at(-1)) && isCjk(after.content[0])
    token.type = 'text'
    token.content = cjk ? '' : ' '
  })
}

/** 中日韩文字与全角标点（与 Rust `render::markdown::is_cjk` 相同的范围）。 */
function isCjk(char: string | undefined): boolean {
  if (char === undefined) return false
  const code = char.codePointAt(0)!
  return (
    (code >= 0x2e80 && code <= 0x2fff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  )
}

function listIsTight(tokens: readonly Token[], index: number): boolean {
  for (let i = index + 1; i < tokens.length; i++) {
    if (tokens[i].type !== 'list_item_open') return tokens[i].hidden
  }
  return false
}

function cellAlign(token: Token): string | null {
  const match = /text-align:\s*(left|center|right)/.exec(token.attrGet('style') ?? '')
  return match ? match[1] : null
}

/** 图片的替代文字：合并全部子节点的文字（强调等标记不保留）。 */
function imageAlt(token: Token): string {
  return (token.children ?? []).map((child) => child.content).join('')
}

function imageAttrs(token: Token) {
  return { src: token.attrGet('src') ?? '', alt: imageAlt(token), title: token.attrGet('title') || null }
}

const parser = new MarkdownParser(schema, tokenizer, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: {
    block: 'list_item',
    getAttrs: (token) => ({ checked: (token.meta as { checked?: boolean } | null)?.checked ?? null }),
  },
  bullet_list: { block: 'bullet_list', getAttrs: (_, tokens, i) => ({ tight: listIsTight(tokens, i) }) },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (token, tokens, i) => ({
      order: Number(token.attrGet('start') ?? 1),
      tight: listIsTight(tokens, i),
    }),
  },
  heading: { block: 'heading', getAttrs: (token) => ({ level: Number(token.tag.slice(1)) }) },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: { block: 'code_block', getAttrs: (token) => ({ params: token.info.trim() }), noCloseToken: true },
  hr: { node: 'horizontal_rule' },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: (token) => ({ align: cellAlign(token) }) },
  td: { block: 'table_cell', getAttrs: (token) => ({ align: cellAlign(token) }) },
  image: { node: 'image', getAttrs: imageAttrs },
  figure: { node: 'figure', getAttrs: imageAttrs },
  hardbreak: { node: 'hard_break' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strike' },
  link: {
    mark: 'link',
    getAttrs: (token) => ({ href: token.attrGet('href') ?? '', title: token.attrGet('title') || null }),
  },
  code_inline: { mark: 'code', noCloseToken: true },
})

/** 把一段 Markdown 解析为文档（粘贴纯文本时也使用）。 */
export function parseMarkdown(markdown: string): Node {
  return parser.parse(markdown)
}

// ---------------------------------------------------------------------------
// 文档 → Markdown

/** 链接 / 图片地址：含空白或尖括号时用 <…> 包裹，否则转义括号。 */
function destination(url: string): string {
  if (/[\s<>]/.test(url)) return `<${url.replace(/[<>]/g, (c) => encodeURIComponent(c))}>`
  return url.replace(/[()\\]/g, '\\$&')
}

function imageMarkdown(state: MarkdownSerializerState, node: Node): string {
  return `![${state.esc(node.attrs.alt)}](${destination(node.attrs.src)}${titlePart(node.attrs.title)})`
}

function titlePart(title: string | null): string {
  return title ? ` "${title.replace(/["\\]/g, '\\$&')}"` : ''
}

/**
 * 行首有特殊含义、但默认转义没有覆盖的写法：`1)` 与行尾的 `1.` / `+`（空列表项）、`=` Setext 标题下划线。
 * `-`、`*`、`>`、`#`、`+ `、`1. ` 已由 esc(…, true) 处理。
 */
function escapeLineStart(escaped: string): string {
  return escaped
    .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2')
    .replace(/^\+(?=\s|$)/, '\\+')
    .replace(/^=/, '\\=')
}

/** 是否位于一行的开头：段落第一个节点，或紧跟在硬换行之后。 */
function atLineStart(parent: Node, index: number): boolean {
  if (index === 0) return parent.type === nodes.paragraph
  return parent.child(index - 1).type === nodes.hard_break
}

/**
 * 行内代码的定界符：比内容中最长的反引号串多一个；内容以反引号开头 / 结尾，
 * 或首尾都是空格（CommonMark 会各去掉一个）时，内侧补一个空格。
 */
function codeDelimiter(code: string, side: 'open' | 'close'): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  const ticks = '`'.repeat(longest + 1)
  const pad = /^`|`$/.test(code) || (/^ /.test(code) && / $/.test(code) && /[^ ]/.test(code))
  if (!pad) return ticks
  return side === 'open' ? `${ticks} ` : ` ${ticks}`
}

/** 列表：第一行是列表标记（加任务标记），后续行缩进 indent。 */
function renderList(
  state: MarkdownSerializerState,
  node: Node,
  marker: (i: number) => string,
  indent: string,
): void {
  const task = (i: number) => {
    const checked: boolean | null = node.child(i).attrs.checked
    return checked === null ? '' : checked ? '[x] ' : '[ ] '
  }
  state.renderList(node, indent, (i) => marker(i) + task(i))
}

/**
 * 相邻的同类列表交替使用两种标记（- / *，1. / 1)），否则再次解析时它们会合并成一个列表。
 * 返回该列表在连续同类列表中的序号是否为奇数。
 */
function alternateMarker(node: Node, parent: Node, index: number): boolean {
  if (alternateTopLevel.has(parent)) return true
  let run = 0
  while (index - run - 1 >= 0 && parent.child(index - run - 1).type === node.type) run++
  return run % 2 === 1
}

function serializeTable(state: MarkdownSerializerState, node: Node): void {
  const rows: string[][] = []
  const aligns: Array<string | null> = []
  node.forEach((row, _, rowIndex) => {
    const cells: string[] = []
    row.forEach((cell) => {
      cells.push(cellMarkdown(cell))
      if (rowIndex === 0) aligns.push(cell.attrs.align)
      // Markdown 没有合并单元格：被合并的位置补空单元格，保持列数。
      for (let extra = 1; extra < cell.attrs.colspan; extra++) {
        cells.push('')
        if (rowIndex === 0) aligns.push(null)
      }
    })
    rows.push(cells)
  })
  const columns = Math.max(1, ...rows.map((cells) => cells.length))
  const line = (cells: readonly string[]) =>
    `| ${Array.from({ length: columns }, (_, i) => cells[i] ?? '').join(' | ')} |`
  const delimiter = Array.from({ length: columns }, (_, i) => {
    const align = aligns[i]
    return align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---'
  })
  const lines = [line(rows[0] ?? []), `| ${delimiter.join(' | ')} |`, ...rows.slice(1).map(line)]
  for (const text of lines) {
    state.write(text)
    state.ensureNewLine()
  }
  state.closeBlock(node)
}

/** 单元格内容按段落序列化，再转义竖线（GFM 在行内解析之前处理 \|，代码中同样适用）。 */
function cellMarkdown(cell: Node): string {
  const paragraph = nodes.paragraph.create(null, cell.content)
  return serializeMarkdown(nodes.doc.create(null, paragraph)).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
}

const baseNodes = defaultMarkdownSerializer.nodes
const baseMarks = defaultMarkdownSerializer.marks

const serializer = new MarkdownSerializer(
  {
    blockquote: baseNodes.blockquote,
    code_block: baseNodes.code_block,
    heading: baseNodes.heading,
    horizontal_rule: baseNodes.horizontal_rule,
    list_item: baseNodes.list_item,
    hard_break: baseNodes.hard_break,
    paragraph(state, node, parent) {
      // 顶层的空段落在 Markdown 中无法表达（只是多余空行），直接省略。
      if (node.content.size === 0 && parent.type === nodes.doc) return
      state.renderInline(node)
      state.closeBlock(node)
    },
    bullet_list(state, node, parent, index) {
      const bullet = alternateMarker(node, parent, index) ? '*' : '-'
      renderList(state, node, () => `${bullet} `, '  ')
    },
    ordered_list(state, node, parent, index) {
      const start: number = node.attrs.order
      const delimiter = alternateMarker(node, parent, index) ? ')' : '.'
      const width = String(start + node.childCount - 1).length
      renderList(
        state,
        node,
        (i) => `${String(start + i).padStart(width, ' ')}${delimiter} `,
        ' '.repeat(width + 2),
      )
    },
    table: serializeTable,
    image(state, node) {
      state.write(imageMarkdown(state, node))
    },
    // 与只含这张图片的段落写法相同：Markdown 中没有新的语法。
    figure(state, node) {
      state.write(imageMarkdown(state, node))
      state.closeBlock(node)
    },
    text(state, node, parent, index) {
      const text = node.text ?? ''
      let escaped = atLineStart(parent, index) ? escapeLineStart(state.esc(text, true)) : state.esc(text)
      // 标题末尾的 # 会被当作 ATX 标题的结束符号而丢掉。
      if (parent.type === nodes.heading && index === parent.childCount - 1) {
        escaped = escaped.replace(/#+(?=\s*$)/, (run) => run.replace(/#/g, '\\#'))
      }
      state.text(escaped, false)
    },
  },
  {
    em: baseMarks.em,
    strong: baseMarks.strong,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    code: {
      open: (_state, _mark, parent, index) => codeDelimiter(parent.child(index).text ?? '', 'open'),
      close: (_state, _mark, parent, index) => codeDelimiter(parent.child(index - 1).text ?? '', 'close'),
      escape: false,
    },
    link: {
      open: '[',
      close: (_state, mark) => `](${destination(mark.attrs.href)}${titlePart(mark.attrs.title)})`,
      mixable: true,
    },
  },
  {
    // 正文中的 HTML 与实体在 Rust 渲染器中不生效，但会改变解析结构：一律转义为文字。
    escapeExtraCharacters: /<(?=[A-Za-z/!?])|&(?=#?[0-9A-Za-z]+;)/g,
  },
)

/**
 * 逐个顶层块序列化，并按块对象缓存结果：编辑长章节时每次只重新序列化改动过的块
 * （prosemirror-markdown 在整篇输出上反复检查行首，一次整篇序列化的耗时随篇幅平方增长）。
 * 顶层块之间与整篇序列化相同：一个空行；相邻的同类列表之间两个空行。
 * 块的写法只取决于它自身，以及它在相邻同类列表中是否使用交替标记（记在 alternateTopLevel 中）。
 */
function serializeMarkdown(doc: Node): string {
  let out = ''
  let previous: Node | null = null
  doc.forEach((block, _, index) => {
    const text = serializeBlock(block, isList(block) && alternateMarker(block, doc, index))
    if (text.length === 0) return
    if (previous) out += isList(block) && previous.type === block.type ? '\n\n\n' : '\n\n'
    out += text
    previous = block
  })
  return out
}

/** 单独序列化时应使用交替标记的顶层列表所在的文档。 */
const alternateTopLevel = new WeakSet<Node>()
const blockMarkdown = new WeakMap<Node, { readonly alternate: boolean; readonly text: string }>()

function serializeBlock(block: Node, alternate: boolean): string {
  const cached = blockMarkdown.get(block)
  if (cached && cached.alternate === alternate) return cached.text
  const doc = representable(nodes.doc.create(null, block))
  if (alternate) alternateTopLevel.add(doc)
  const text = serializer.serialize(doc).replace(/\s+$/, '')
  blockMarkdown.set(block, { alternate, text })
  return text
}

function isList(node: Node): boolean {
  return node.type === nodes.bullet_list || node.type === nodes.ordered_list
}

// ---------------------------------------------------------------------------
// 写出前的调整：让每个文本块都能被 Markdown 准确表达
//
// 编辑器中可以做出一些 Markdown 无法原样表达的内容。写出前按渲染结果等价地调整，
// 保证文字永远不会被破坏（不会多出字面的 * 或丢字），编辑器中的文档不受影响：
// 1. 行首 / 行尾的空白、段首段尾的硬换行在 Markdown 中不显示（段首四个空格还会变成代码块）：去掉。
// 2. CommonMark 的 * / ~~ 只有在两侧字符满足 flanking 规则时才生效：标记内侧紧挨空白，或内侧紧挨标点、
//    外侧紧挨文字时（中文里很常见：是**“重要”**的）会变成字面的星号。
//    把这类边界上的空白与标点移到标记之外（是“**重要**”的）。
// 3. 兜底：写出后再次解析，格式仍不能原样读回时（相邻的多种强调互相嵌套等），
//    依次去掉强调、全部格式，直到文字能原样读回。

const FLANKING_MARKS = [marks.strong, marks.em, marks.strike]

const isPunctuation = (char: string) => /[\p{P}\p{S}]/u.test(char)
const isSpace = (char: string | null) => char !== null && /\s/u.test(char)
const isWord = (char: string | null) => char !== null && !/\s/u.test(char) && !isPunctuation(char)

/** 未变化的文本块在多次序列化之间保持同一对象，按对象缓存调整结果。 */
const representableBlocks = new WeakMap<Node, Node>()

/** 文档中所有文本块都能用 Markdown 表达的版本；无需调整时返回同一文档。 */
function representable(doc: Node): Node {
  let changed = false
  const blocks: Node[] = []
  doc.descendants((node) => {
    if (!node.isTextblock) return true
    const adjusted = representableBlock(node)
    if (adjusted !== node) changed = true
    blocks.push(adjusted)
    return false
  })
  if (!changed) return doc
  let index = 0
  return mapTextblocks(doc, () => blocks[index++])
}

function mapTextblocks(node: Node, next: () => Node): Node {
  if (node.isTextblock) return next()
  if (node.isLeaf) return node
  const children: Node[] = []
  node.forEach((child) => children.push(mapTextblocks(child, next)))
  return node.copy(Fragment.from(children))
}

function representableBlock(block: Node): Node {
  if (block.type.spec.code) return block
  const cached = representableBlocks.get(block)
  if (cached) return cached
  const adjusted = adjustEmphasis(trimLines(block))
  let result = adjusted
  if (hasMarks(adjusted) && !roundTrips(adjusted)) {
    const fallbacks = [withoutMarks(adjusted, FLANKING_MARKS), withoutMarks(adjusted, null)]
    result = fallbacks.find(roundTrips) ?? adjusted
  }
  representableBlocks.set(block, result)
  return result
}

function hasMarks(block: Node): boolean {
  let found = false
  block.forEach((child) => {
    if (child.marks.length > 0) found = true
  })
  return found
}

/** 去掉指定类型（null 表示全部）的格式，文字不变。 */
function withoutMarks(block: Node, types: readonly MarkType[] | null): Node {
  const children: Node[] = []
  block.forEach((child) => {
    children.push(child.mark(child.marks.filter((mark) => types !== null && !types.includes(mark.type))))
  })
  return block.copy(Fragment.fromArray(children))
}

/** 文本块的内容写成 Markdown 后再次解析，是否得到完全相同的内容。 */
function roundTrips(block: Node): boolean {
  const paragraph = nodes.paragraph.create(null, block.content)
  const parsed = parser.parse(serializer.serialize(nodes.doc.create(null, paragraph)))
  const first = parsed.firstChild
  return parsed.childCount === 1 && first!.type === nodes.paragraph && first!.content.eq(paragraph.content)
}

/** 去掉每行（以硬换行分隔）首尾的空白（行内代码中的空白保留），以及段首、段尾的硬换行。 */
function trimLines(block: Node): Node {
  const original: Node[] = []
  block.forEach((child) => original.push(child))
  const isBreak = (node: Node | undefined) => node?.type === nodes.hard_break
  const trim = (node: Node, pattern: RegExp): Node | null => {
    if (!node.isText || marks.code.isInSet(node.marks)) return node
    const value = node.text!.replace(pattern, '')
    if (value.length === 0) return null
    return value === node.text ? node : schema.text(value, node.marks)
  }
  const starts: Node[] = []
  for (const child of original) {
    const lineStart = starts.length === 0 || isBreak(starts.at(-1))
    const node = lineStart ? trim(child, /^[ \t]+/) : child
    if (node) starts.push(node)
  }
  const ends: Node[] = []
  for (let i = starts.length - 1; i >= 0; i--) {
    const lineEnd = ends.length === 0 || isBreak(ends[0])
    const node = lineEnd ? trim(starts[i], /[ \t]+$/) : starts[i]
    if (node) ends.unshift(node)
  }
  while (isBreak(ends[0])) ends.shift()
  while (isBreak(ends.at(-1))) ends.pop()
  if (ends.length === original.length && ends.every((child, i) => child === original[i])) return block
  return block.copy(Fragment.fromArray(ends))
}

interface Unit {
  /** 文字的一个字符；图片、硬换行等为 null。 */
  readonly char: string | null
  node: Node
}

function adjustEmphasis(block: Node): Node {
  let relevant = false
  block.forEach((child) => {
    if (child.marks.some((mark) => FLANKING_MARKS.includes(mark.type))) relevant = true
  })
  if (!relevant) return block

  const units: Unit[] = []
  block.forEach((child) => {
    if (!child.isText) units.push({ char: null, node: child })
    else for (const char of child.text!) units.push({ char, node: schema.text(char, child.marks) })
  })
  const charAt = (i: number) => (i < 0 || i >= units.length ? null : units[i].char ?? '\n')

  let changed = false
  for (const type of FLANKING_MARKS) {
    let i = 0
    while (i < units.length) {
      if (!type.isInSet(units[i].node.marks)) {
        i++
        continue
      }
      let end = i
      while (end < units.length && type.isInSet(units[end].node.marks)) end++
      let start = i
      const drop = (index: number) => {
        units[index].node = units[index].node.mark(type.removeFromSet(units[index].node.marks))
        changed = true
      }
      // 标记内侧的空白移到外侧（Markdown 中 ** 内侧不能紧挨空白）；内侧是标点而外侧是文字时，标点移到外侧。
      const movable = (inner: string | null, outer: string | null) =>
        isSpace(inner) || (isPunctuation(inner ?? '') && isWord(outer))
      while (start < end && movable(charAt(start), charAt(start - 1))) drop(start++)
      while (end > start && movable(charAt(end - 1), charAt(end))) drop(--end)
      i = Math.max(end, i + 1)
      while (i < units.length && type.isInSet(units[i].node.marks)) i++
    }
  }
  if (!changed) return block
  return block.copy(Fragment.fromArray(units.map((unit) => unit.node)))
}

// ---------------------------------------------------------------------------
// 章节不在编辑器中时直接追加图片（例如选择图片期间切换了章节）。

/** 把图片作为新的一段追加到正文末尾，保留原有正文的每一个字节。 */
export function appendImage(text: string, reference: string, alt: string): string {
  const image = serializeMarkdown(
    nodes.doc.create(null, nodes.figure.create({ src: reference, alt })),
  )
  const lead = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  return `${text}${lead}${image}\n`
}
