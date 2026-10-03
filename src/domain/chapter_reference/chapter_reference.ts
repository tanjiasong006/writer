import type { ChapterId } from '../chapter_tree/chapter_tree.ts'

/**
 * 交叉引用的地址（docs/project-format.md 第 4.1 节）：
 * - 章节：`writer:chapter/<百分号编码的 id>[?show=number|title]`；
 * - 图表（docs/decisions.md 第 12 节）：`writer:figure/<id>`、`writer:table/<id>`，没有显示格式。
 * Rust `render::chapter_reference` 按同一规则解析，由共享 Markdown fixture 约束。
 */

/** 引用的显示格式：编号 + 标题（默认）、仅编号、仅标题。 */
export type ChapterRefShow = 'number-title' | 'number' | 'title'

export type ChapterRefAddress =
  /** 不是 Writer 的地址：普通链接。 */
  | { readonly kind: 'link' }
  /** 以 `writer:` 开头但不符合格式：失效引用。 */
  | { readonly kind: 'malformed' }
  | { readonly kind: 'ref'; readonly id: ChapterId; readonly show: ChapterRefShow }
  /** 图或表：id 是图片 title 中 `fig:` 之后、表格标题中 `{#tbl:…}` 的标识。 */
  | { readonly kind: 'element'; readonly element: ElementKind; readonly id: string }

/** 可以被引用的元素：图（独立成段、有图注的图片）与表（有标题的表格）。 */
export type ElementKind = 'figure' | 'table'

const SCHEME = 'writer:'
const PREFIX = 'writer:chapter/'
const ELEMENT_PREFIXES: ReadonlyArray<readonly [ElementKind, string]> = [
  ['figure', 'writer:figure/'],
  ['table', 'writer:table/'],
]

/** 解析链接地址。任何输入都不会抛出。 */
export function parseChapterRefAddress(href: string): ChapterRefAddress {
  if (!href.startsWith(SCHEME)) return { kind: 'link' }
  for (const [element, prefix] of ELEMENT_PREFIXES) {
    if (!href.startsWith(prefix)) continue
    const encoded = href.slice(prefix.length)
    const id = decode(encoded)
    if (id === null || !isElementId(id) || /[/?#]/.test(encoded)) return { kind: 'malformed' }
    return { kind: 'element', element, id }
  }
  if (!href.startsWith(PREFIX)) return { kind: 'malformed' }
  const rest = href.slice(PREFIX.length)
  const query = rest.indexOf('?')
  const encoded = query === -1 ? rest : rest.slice(0, query)
  const id = decode(encoded)
  if (id === null || id === '' || /[/?#]/.test(encoded)) return { kind: 'malformed' }
  if (query === -1) return { kind: 'ref', id, show: 'number-title' }
  const match = /^show=([^&#]*)$/.exec(rest.slice(query + 1))
  if (!match) return { kind: 'malformed' }
  const show = match[1] === 'number' || match[1] === 'title' ? match[1] : 'number-title'
  return { kind: 'ref', id, show }
}

/** 引用地址的规范写法：省略默认格式。 */
export function chapterRefAddress(id: ChapterId, show: ChapterRefShow): string {
  const address = PREFIX + encodeURIComponent(id)
  return show === 'number-title' ? address : `${address}?show=${show}`
}

/** 图表引用地址的规范写法。 */
export function elementRefAddress(element: ElementKind, id: string): string {
  return `writer:${element}/${encodeURIComponent(id)}`
}

/** 图表的标识：字母、数字、- 与 _（写在图片 title 与表格标题中，不需要转义）。 */
export function isElementId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

/** 新的图表标识：8 位小写字母与数字。 */
export function newElementId(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 8; i++) id += alphabet[Math.floor(random() * alphabet.length)]
  return id
}

/**
 * 图表的编号：按一级章节分组，“图 2-1”“表 3-2”（一级章节号-章内序号）；
 * chapter 为 null（文档没有章节编号可用）时只有序号。
 */
export function elementLabel(element: ElementKind, chapter: number | null, index: number): string {
  const name = element === 'figure' ? '图' : '表'
  return chapter === null ? `${name} ${index}` : `${name} ${chapter}-${index}`
}

/** 严格的百分号解码：% 后必须是两位十六进制，解码结果必须是合法的 UTF-8。 */
function decode(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

/**
 * 引用显示的文字。number 是该输出中编号的写法（如 "2.1"、"第 2 章"），不显示编号时为 null。
 * 不显示编号时只显示标题；标题为空时只显示编号。
 */
export function chapterRefText(number: string | null, title: string, show: ChapterRefShow): string {
  if (number === null) return title
  if (title === '' || show === 'number') return number
  return show === 'title' ? title : `${number} ${title}`
}
