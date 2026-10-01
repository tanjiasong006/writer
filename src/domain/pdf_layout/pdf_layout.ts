/**
 * PDF 排版配置：文档级、语义化、分档的少量选项（docs/pdf-layout.md 第 4 节）。
 *
 * 项目只保存用户改过的项（PdfLayoutSettings，稀疏）；未改的项始终跟随当前默认值，
 * 默认值改进后旧项目自动受益。导出时用 resolvePdfLayout 合并出完整配置（PdfLayout）。
 * 配置不属于 WriterDocument，只作用于 PDF。
 */

export interface PdfLayout {
  readonly paper: 'a4' | 'b5' | 'a5' | 'letter'
  readonly margin: 'narrow' | 'normal' | 'wide'
  readonly binding: 'single' | 'double'
  readonly bodyFont: 'serif' | 'sans'
  readonly headingFont: 'serif' | 'sans'
  /** 正文字号（磅）：五号 / 小四 / 四号。 */
  readonly bodySize: 10.5 | 12 | 14
  readonly lineHeight: 'compact' | 'normal' | 'loose'
  readonly paragraph: 'indent' | 'spacing'
  readonly cover: boolean
  readonly toc: boolean
  readonly tocDepth: 1 | 2 | 3
  readonly chapterNewPage: boolean
  /** 章节编号：1 / 第 1 章 / 不显示。 */
  readonly chapterNumber: 'plain' | 'chapter' | 'none'
  readonly header: 'none' | 'title' | 'titleAndChapter'
  /** 页码：1 / 第 1 页 / 1 / N。 */
  readonly pageNumber: 'plain' | 'page' | 'total'
  readonly table: 'threeLine' | 'grid'
}

export type PdfLayoutKey = keyof PdfLayout

/** 用户改过的项；没有出现的项跟随默认值。 */
export type PdfLayoutSettings = { readonly [K in PdfLayoutKey]?: PdfLayout[K] }

export const DEFAULT_PDF_LAYOUT: PdfLayout = {
  paper: 'a4',
  margin: 'normal',
  binding: 'single',
  bodyFont: 'serif',
  headingFont: 'sans',
  bodySize: 12,
  lineHeight: 'normal',
  paragraph: 'indent',
  cover: true,
  toc: true,
  tocDepth: 2,
  chapterNewPage: true,
  chapterNumber: 'plain',
  header: 'titleAndChapter',
  pageNumber: 'plain',
  table: 'threeLine',
}

/** 每一项的全部可选值（按界面中的顺序）。 */
export const PDF_LAYOUT_OPTIONS: { readonly [K in PdfLayoutKey]: readonly PdfLayout[K][] } = {
  paper: ['a4', 'b5', 'a5', 'letter'],
  margin: ['narrow', 'normal', 'wide'],
  binding: ['single', 'double'],
  bodyFont: ['serif', 'sans'],
  headingFont: ['sans', 'serif'],
  bodySize: [10.5, 12, 14],
  lineHeight: ['compact', 'normal', 'loose'],
  paragraph: ['indent', 'spacing'],
  cover: [true, false],
  toc: [true, false],
  tocDepth: [1, 2, 3],
  chapterNewPage: [true, false],
  chapterNumber: ['plain', 'chapter', 'none'],
  header: ['none', 'title', 'titleAndChapter'],
  pageNumber: ['plain', 'page', 'total'],
  table: ['threeLine', 'grid'],
}

/** 全部配置项（按界面中的顺序）。 */
export const PDF_LAYOUT_KEYS = Object.keys(DEFAULT_PDF_LAYOUT) as readonly PdfLayoutKey[]

/** value 是否是 key 的合法取值。 */
export function isPdfLayoutValue<K extends PdfLayoutKey>(key: K, value: unknown): value is PdfLayout[K] {
  return (PDF_LAYOUT_OPTIONS[key] as readonly unknown[]).includes(value)
}

/** 合并出完整配置：用户改过的项覆盖默认值。 */
export function resolvePdfLayout(settings: PdfLayoutSettings): PdfLayout {
  return { ...DEFAULT_PDF_LAYOUT, ...settings }
}

/**
 * 修改一项。取值等于默认值时不再记录（回到跟随默认值）；结果不变时返回同一对象。
 */
export function setPdfLayoutOption<K extends PdfLayoutKey>(
  settings: PdfLayoutSettings,
  key: K,
  value: PdfLayout[K],
): PdfLayoutSettings {
  if (value === DEFAULT_PDF_LAYOUT[key]) {
    if (!(key in settings)) return settings
    const next = { ...settings }
    delete next[key]
    return next
  }
  return settings[key] === value ? settings : { ...settings, [key]: value }
}

/** 是否改过任何一项（"恢复默认"是否可用）。 */
export function isDefaultPdfLayout(settings: PdfLayoutSettings): boolean {
  return Object.keys(settings).length === 0
}
