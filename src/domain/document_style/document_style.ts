/**
 * 文档样式：整本文档的视觉设计（主题），以及少数确实属于单个元素的布局（图片）。
 *
 * 分层（docs/decisions.md 第 8 节）：
 * - 正文 Markdown 只表达内容与语义，不含任何排版信息；
 * - 主题决定"一类元素通常怎么显示"，用户可以在主题之上调整少数字段（overrides）；
 * - 图片的尺寸 / 对齐是图片文件（asset）级的布局覆盖，按图片文件键（imageKey）保存，不写进正文；
 *   同一文件的所有出现共享布局，这不是元素实例身份。
 *
 * 这里只有语义参数（字体族、磅值、倍数），不含 CSS 或任何渲染器的实现；
 * 编辑器、预览、Word、PDF 各自把 DocumentTheme 翻译成自己的样式。
 */

/** 受控的字体族：每个渲染器都能可靠提供（中英文 fallback 链由各渲染器负责）。 */
export type FontId = 'serif' | 'sans'
export const FONT_IDS: readonly FontId[] = ['serif', 'sans']

export type ThemeId = 'book' | 'classic' | 'technical'
export const THEME_IDS: readonly ThemeId[] = ['book', 'classic', 'technical']
export const DEFAULT_THEME_ID: ThemeId = 'book'

/**
 * 图片尺寸。original：按图片本身大小（96 DPI），不超过正文宽度；
 * 其余为正文宽度的固定比例（见 IMAGE_WIDTH_RATIO）。任何尺寸下高度都不超过统一上限。
 */
export type ImageSize = 'original' | 'small' | 'medium' | 'large' | 'full'
export const IMAGE_SIZES: readonly ImageSize[] = ['original', 'small', 'medium', 'large', 'full']
export type ImageAlign = 'left' | 'center' | 'right'
export const IMAGE_ALIGNS: readonly ImageAlign[] = ['left', 'center', 'right']

/** 各尺寸占正文宽度的比例；original 不在此列。 */
export const IMAGE_WIDTH_RATIO: Readonly<Record<Exclude<ImageSize, 'original'>, number>> = {
  small: 0.4,
  medium: 0.65,
  large: 0.85,
  full: 1,
}

/** 字号（磅）与行距（字号的倍数）的合法范围：信任边界上的限制，防止异常值进入各渲染器。 */
export const FONT_SIZE_RANGE = { min: 6, max: 72 } as const
export const LINE_HEIGHT_RANGE = { min: 1, max: 3 } as const

export interface TextStyle {
  readonly font: FontId
  /** 磅。 */
  readonly size: number
}

export interface BodyStyle extends TextStyle {
  /** 行距：相邻两行基线的距离 / 字号。 */
  readonly lineHeight: number
  /** 段落之间在正常行距之外额外的间距（em）。 */
  readonly paragraphSpacing: number
}

export interface HeadingStyle extends TextStyle {
  /** 标题前后的间距（em，相对标题字号）。标题一律加粗。 */
  readonly spacingBefore: number
  readonly spacingAfter: number
}

export interface ImageLayout {
  readonly size: ImageSize
  readonly align: ImageAlign
}

export interface DocumentTheme {
  readonly body: BodyStyle
  /** 文档标题（预览与导出的第一行）。 */
  readonly title: TextStyle
  /** 第 1、2、3 级标题；更深的层级使用第 3 级（headingStyle）。 */
  readonly heading1: HeadingStyle
  readonly heading2: HeadingStyle
  readonly heading3: HeadingStyle
  readonly blockquote: TextStyle
  /** 代码块字号（字体固定为等宽）。 */
  readonly codeBlock: { readonly size: number }
  readonly table: { readonly size: number }
  /** 独立成段的图片：默认尺寸、对齐与前后间距（em，相对正文字号）。 */
  readonly image: ImageLayout & { readonly spacing: number }
  /** 图注（图片的替代文字）。 */
  readonly caption: TextStyle
}

/** 用户在主题之上可以调整的字段。未出现的字段跟随主题。 */
export interface StyleOverrides {
  readonly bodyFont?: FontId
  readonly bodySize?: number
  readonly lineHeight?: number
  readonly headingFont?: FontId
  readonly heading1Size?: number
  readonly heading2Size?: number
  readonly heading3Size?: number
}

export type StyleOverrideField = keyof StyleOverrides

/** 单张图片的布局；未出现的字段跟随主题。 */
export interface ImageOverride {
  readonly size?: ImageSize
  readonly align?: ImageAlign
}

/** 图片文件键（imageKey）→ 布局。 */
export type ImageLayouts = ReadonlyMap<string, ImageOverride>

/**
 * 一份文档的样式设置（持久化的内容）：主题、主题之上的调整、图片布局。
 * 不变量：overrides 的值都在合法范围内且与主题值不同；images 中没有空布局。
 */
export interface DocumentStyle {
  readonly theme: ThemeId
  readonly overrides: StyleOverrides
  readonly images: ImageLayouts
}

const heading = (font: FontId, size: number, spacingBefore: number, spacingAfter: number): HeadingStyle => ({
  font,
  size,
  spacingBefore,
  spacingAfter,
})

/** 内置主题。book 是默认主题，与引入主题之前的导出排版基本一致。 */
export const THEMES: Readonly<Record<ThemeId, DocumentTheme>> = {
  book: {
    body: { font: 'serif', size: 12, lineHeight: 1.8, paragraphSpacing: 0.5 },
    title: { font: 'sans', size: 22 },
    heading1: heading('sans', 16, 1.4, 0.6),
    heading2: heading('sans', 14, 1.2, 0.5),
    heading3: heading('sans', 13, 1, 0.4),
    blockquote: { font: 'serif', size: 12 },
    codeBlock: { size: 10 },
    table: { size: 11 },
    image: { size: 'original', align: 'center', spacing: 1 },
    caption: { font: 'serif', size: 10 },
  },
  /** 传统：全部宋体，行距更宽松，标题略大。 */
  classic: {
    body: { font: 'serif', size: 12, lineHeight: 2, paragraphSpacing: 0.4 },
    title: { font: 'serif', size: 24 },
    heading1: heading('serif', 18, 1.6, 0.8),
    heading2: heading('serif', 15, 1.3, 0.6),
    heading3: heading('serif', 13, 1.1, 0.5),
    blockquote: { font: 'serif', size: 11 },
    codeBlock: { size: 10 },
    table: { size: 10.5 },
    image: { size: 'original', align: 'center', spacing: 1.2 },
    caption: { font: 'serif', size: 10.5 },
  },
  /** 技术文档：全部黑体，字号更小、行距更紧凑，图片默认放大到正文宽度的 85%。 */
  technical: {
    body: { font: 'sans', size: 10.5, lineHeight: 1.6, paragraphSpacing: 0.6 },
    title: { font: 'sans', size: 20 },
    heading1: heading('sans', 15, 1.4, 0.6),
    heading2: heading('sans', 13, 1.2, 0.5),
    heading3: heading('sans', 11.5, 1, 0.4),
    blockquote: { font: 'sans', size: 10.5 },
    codeBlock: { size: 9 },
    table: { size: 9.5 },
    image: { size: 'large', align: 'center', spacing: 0.8 },
    caption: { font: 'sans', size: 9 },
  },
}

export function defaultDocumentStyle(): DocumentStyle {
  return { theme: DEFAULT_THEME_ID, overrides: {}, images: new Map() }
}

/** 没有任何设置（使用默认主题，没有调整和图片布局）；这样的样式不需要写入项目文件。 */
export function isDefaultStyle(style: DocumentStyle): boolean {
  return style.theme === DEFAULT_THEME_ID && Object.keys(style.overrides).length === 0 && style.images.size === 0
}

/** 主题 + 用户调整 → 各渲染器使用的完整语义样式。 */
export function resolveTheme(style: DocumentStyle): DocumentTheme {
  const base = THEMES[style.theme]
  const o = style.overrides
  const headingFont = o.headingFont
  const withHeading = (h: HeadingStyle, size: number | undefined): HeadingStyle => ({
    ...h,
    font: headingFont ?? h.font,
    size: size ?? h.size,
  })
  return {
    ...base,
    body: {
      ...base.body,
      font: o.bodyFont ?? base.body.font,
      size: o.bodySize ?? base.body.size,
      lineHeight: o.lineHeight ?? base.body.lineHeight,
    },
    title: { ...base.title, font: headingFont ?? base.title.font },
    heading1: withHeading(base.heading1, o.heading1Size),
    heading2: withHeading(base.heading2, o.heading2Size),
    heading3: withHeading(base.heading3, o.heading3Size),
  }
}

/** 第 level 级标题（从 1 开始）的样式：第 3 级及更深使用 heading3。 */
export function headingStyle(theme: DocumentTheme, level: number): HeadingStyle {
  if (level <= 1) return theme.heading1
  if (level === 2) return theme.heading2
  return theme.heading3
}

/** 主题中与某个调整字段对应的值（用于显示"跟随主题"时的当前值）。 */
export function themeValue(theme: DocumentTheme, field: StyleOverrideField): FontId | number {
  switch (field) {
    case 'bodyFont':
      return theme.body.font
    case 'bodySize':
      return theme.body.size
    case 'lineHeight':
      return theme.body.lineHeight
    case 'headingFont':
      return theme.heading1.font
    case 'heading1Size':
      return theme.heading1.size
    case 'heading2Size':
      return theme.heading2.size
    case 'heading3Size':
      return theme.heading3.size
  }
}

/** 切换主题：之前在旧主题上做的调整一并清除（主题是一整套设计）；图片布局保留。 */
export function selectTheme(style: DocumentStyle, theme: ThemeId): DocumentStyle {
  if (theme === style.theme && Object.keys(style.overrides).length === 0) return style
  return { ...style, theme, overrides: {} }
}

/**
 * 修改若干调整字段。值为 undefined 或与主题相同 → 去掉该调整（跟随主题）；
 * 非法值（超出范围、未知字体）被忽略。结果不变时返回同一对象。
 */
export function overrideStyle(style: DocumentStyle, patch: StyleOverrides): DocumentStyle {
  const base = THEMES[style.theme]
  const next: Record<string, FontId | number> = { ...style.overrides }
  for (const field of Object.keys(patch) as StyleOverrideField[]) {
    const value = patch[field]
    if (value === undefined || value === themeValue(base, field)) delete next[field]
    else if (isValidOverride(field, value)) next[field] = value
  }
  return sameRecord(next, style.overrides) ? style : { ...style, overrides: next as StyleOverrides }
}

/** 去掉所有调整，完全使用主题。 */
export function resetOverrides(style: DocumentStyle): DocumentStyle {
  return Object.keys(style.overrides).length === 0 ? style : { ...style, overrides: {} }
}

export function isValidOverride(field: StyleOverrideField, value: unknown): boolean {
  switch (field) {
    case 'bodyFont':
    case 'headingFont':
      return isFontId(value)
    case 'lineHeight':
      return inRange(value, LINE_HEIGHT_RANGE)
    default:
      return inRange(value, FONT_SIZE_RANGE)
  }
}

/** 设置一张图片的布局；null 或空布局表示跟随主题（去掉记录）。结果不变时返回同一对象。 */
export function setImageLayout(style: DocumentStyle, key: string, layout: ImageOverride | null): DocumentStyle {
  const clean = layout === null ? null : cleanOverride(layout)
  const current = style.images.get(key)
  if (clean === null ? current === undefined : current !== undefined && sameRecord(clean, current)) return style
  const images = new Map(style.images)
  if (clean === null) images.delete(key)
  else images.set(key, clean)
  return { ...style, images }
}

/** 图片实际使用的布局：图片自己的设置优先，其余跟随主题。 */
export function effectiveImageLayout(theme: DocumentTheme, override: ImageOverride | undefined): ImageLayout {
  return { size: override?.size ?? theme.image.size, align: override?.align ?? theme.image.align }
}

/**
 * 图片文件键：正文中的图片引用（相对 content/，可含 %XX 编码）指向的项目内文件，
 * 以相对项目根目录、用 / 分隔的规范路径表示（如 assets/图.png）。
 *
 * 这是文件级的键，不是元素实例身份：同一个文件的所有引用共享同一个键（因此共享布局）。
 * 插入、删除、移动其他图片不会改变它，剪切粘贴到其他位置或章节后布局随之保留。远程地址、绝对路径、非法编码、
 * 越出项目目录的引用没有身份（返回 null）。与 Rust `render::image_key` 规则一致。
 */
export function imageKey(reference: string): string | null {
  if (reference.length === 0 || reference.includes('://') || reference.startsWith('data:')) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(reference)
  } catch {
    return null
  }
  if (/^([\\/]|[A-Za-z]:)/.test(decoded)) return null
  const parts = ['content']
  for (const part of decoded.split(/[\\/]/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.length === 0 ? null : parts.join('/')
}

export function isThemeId(value: unknown): value is ThemeId {
  return (THEME_IDS as readonly unknown[]).includes(value)
}

export function isFontId(value: unknown): value is FontId {
  return (FONT_IDS as readonly unknown[]).includes(value)
}

export function isImageSize(value: unknown): value is ImageSize {
  return (IMAGE_SIZES as readonly unknown[]).includes(value)
}

export function isImageAlign(value: unknown): value is ImageAlign {
  return (IMAGE_ALIGNS as readonly unknown[]).includes(value)
}

function inRange(value: unknown, range: { readonly min: number; readonly max: number }): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max
}

function cleanOverride(layout: ImageOverride): ImageOverride | null {
  const clean: { size?: ImageSize; align?: ImageAlign } = {}
  if (isImageSize(layout.size)) clean.size = layout.size
  if (isImageAlign(layout.align)) clean.align = layout.align
  return Object.keys(clean).length === 0 ? null : clean
}

function sameRecord(a: object, b: object): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  return ak.length === bk.length && ak.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
}
