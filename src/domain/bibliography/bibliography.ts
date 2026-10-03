/**
 * 参考文献（docs/decisions.md 第 13 节）：文档中的文献条目、著录格式与引用顺序。
 *
 * - 条目属于文档内容，随项目保存（writer.json 的 references）。
 * - 正文中的引用是地址为 `writer:cite/<id>` 的链接；按全文中第一次出现的顺序编号（顺序编码制），
 *   同一条目再次引用使用同一编号。只有被引用的条目出现在输出的参考文献表中。
 * - 著录格式按 GB/T 7714—2015 顺序编码制（文献类型标识 [M]、[J] 等是标准的一部分，不是界面文字）。
 */

/** 文献类型：专著、期刊文章、析出文献（书中的章节）、学位论文、报告、电子资源、其他。 */
export type ReferenceType = 'book' | 'article' | 'chapter' | 'thesis' | 'report' | 'web' | 'other'

export const REFERENCE_TYPES: readonly ReferenceType[] = ['book', 'article', 'chapter', 'thesis', 'report', 'web', 'other']

export interface ReferenceEntry {
  /** 稳定的标识：字母、数字、- 与 _，正文中的引用地址使用它。 */
  readonly id: string
  readonly type: ReferenceType
  /** 作者，多位作者以分号（; 或 ；）分隔。 */
  readonly author: string
  readonly title: string
  /** 刊名、书名（析出文献所在的书）或网站名称。 */
  readonly container: string
  readonly publisher: string
  /** 出版地（学位论文为学校所在地）。 */
  readonly place: string
  readonly year: string
  readonly volume: string
  readonly issue: string
  readonly pages: string
  readonly url: string
  readonly doi: string
}

/** 字符串字段（除 id 与 type 之外）。 */
export const REFERENCE_FIELDS = [
  'author',
  'title',
  'container',
  'publisher',
  'place',
  'year',
  'volume',
  'issue',
  'pages',
  'url',
  'doi',
] as const satisfies ReadonlyArray<keyof ReferenceEntry>

export type ReferenceField = (typeof REFERENCE_FIELDS)[number]

/** 新条目：字段为空。 */
export function emptyReference(id: string, type: ReferenceType = 'book'): ReferenceEntry {
  const entry: Record<string, string> = { id, type }
  for (const field of REFERENCE_FIELDS) entry[field] = ''
  return entry as unknown as ReferenceEntry
}

export function isReferenceId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

/** 引用地址：`writer:cite/<id>`。 */
export function citationAddress(id: string): string {
  return `writer:cite/${id}`
}

/** 引用地址中的条目标识；不是引用地址（或标识不合法）时为 null。 */
export function parseCitationAddress(href: string): string | null {
  if (!href.startsWith('writer:cite/')) return null
  const id = href.slice('writer:cite/'.length)
  return isReferenceId(id) ? id : null
}

/**
 * 信任边界上的校验：不是对象、标识不合法或重复、类型未知、字段不是字符串时返回 null。
 * 缺省的字段按空串处理；未知字段忽略。
 */
export function validateReferences(raw: unknown): ReferenceEntry[] | null {
  if (!Array.isArray(raw)) return null
  const ids = new Set<string>()
  const entries: ReferenceEntry[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || !isReferenceId(record.id) || ids.has(record.id)) return null
    if (!REFERENCE_TYPES.includes(record.type as ReferenceType)) return null
    const entry: Record<string, string> = { id: record.id, type: record.type as string }
    for (const field of REFERENCE_FIELDS) {
      const value = record[field] ?? ''
      if (typeof value !== 'string') return null
      entry[field] = value
    }
    ids.add(record.id)
    entries.push(entry as unknown as ReferenceEntry)
  }
  return entries
}

/** 写入 writer.json 的形式：只写出非空字段。 */
export function serializeReference(entry: ReferenceEntry): Record<string, string> {
  const out: Record<string, string> = { id: entry.id, type: entry.type }
  for (const field of REFERENCE_FIELDS) {
    const value = entry[field].trim()
    if (value !== '') out[field] = value
  }
  return out
}

const TYPE_CODES: Readonly<Record<ReferenceType, string>> = {
  book: 'M',
  article: 'J',
  chapter: 'M',
  thesis: 'D',
  report: 'R',
  web: 'EB/OL',
  other: 'Z',
}

/** 作者：最多列出 3 位，更多时加“等”（西文作者加 et al.）。 */
function authors(value: string): string {
  const names = value
    .split(/[;；]/)
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.length <= 3) return names.join(', ')
  const latin = /^[\x20-\x7e]+$/.test(names[0])
  return `${names.slice(0, 3).join(', ')}, ${latin ? 'et al' : '等'}`
}

/** 连接非空的部分。 */
function join(parts: ReadonlyArray<string | false>, separator: string): string {
  return parts.filter((part): part is string => !!part && part.trim() !== '').join(separator)
}

/**
 * 一条文献的著录文字（GB/T 7714—2015 顺序编码制，不含序号）。缺少的项省略，不留空的标点。
 * 例：张三, 李四. 长文档写作[M]. 北京: 某出版社, 2020: 12-20.
 */
export function formatReference(entry: ReferenceEntry): string {
  const e = Object.fromEntries(REFERENCE_FIELDS.map((field) => [field, entry[field].trim()])) as Record<ReferenceField, string>
  const title = `${e.title || '（无题名）'}[${TYPE_CODES[entry.type]}]`
  const head = join([authors(e.author), title], '. ')
  const publication = join([e.place && e.publisher ? `${e.place}: ${e.publisher}` : e.place || e.publisher, e.year], ', ')
  const withPages = (text: string) => (e.pages ? `${text}: ${e.pages}` : text)
  let body: string
  switch (entry.type) {
    case 'article': {
      const volume = e.volume ? `${e.volume}${e.issue ? `(${e.issue})` : ''}` : e.issue ? `(${e.issue})` : ''
      body = withPages(join([e.container, e.year, volume], ', '))
      break
    }
    case 'chapter':
      body = withPages(join([e.container && `//${e.container}`, publication], '. '))
      break
    case 'web':
      body = join([e.container, e.year && `(${e.year})`], ' ')
      break
    default:
      body = withPages(publication)
  }
  const locator = e.doi ? `DOI: ${e.doi}` : e.url
  // 析出文献的“//书名”紧接在题名之后，不用句点隔开。
  const main = entry.type === 'chapter' && body.startsWith('//') ? `${head}${body}` : join([head, body], '. ')
  return `${join([main, locator], '. ')}.`
}

/**
 * 引用的编号：按出现顺序（hrefs 是全文中引用地址的序列）给被引用的条目编号，从 1 开始。
 * 不存在的条目不编号（失效引用）。
 */
export function citationNumbers(hrefs: Iterable<string>, entries: readonly ReferenceEntry[]): Map<string, number> {
  const known = new Set(entries.map((entry) => entry.id))
  const numbers = new Map<string, number>()
  for (const href of hrefs) {
    const id = parseCitationAddress(href)
    if (id !== null && known.has(id) && !numbers.has(id)) numbers.set(id, numbers.size + 1)
  }
  return numbers
}

/** 新条目的标识：8 位小写字母与数字，不与已有的重复。 */
export function newReferenceId(existing: readonly ReferenceEntry[], random: () => number = Math.random): string {
  const ids = new Set(existing.map((entry) => entry.id))
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (;;) {
    let id = ''
    for (let i = 0; i < 8; i++) id += alphabet[Math.floor(random() * alphabet.length)]
    if (!ids.has(id)) return id
  }
}
