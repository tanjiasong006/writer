/**
 * 编辑环境的正文展示参数 → CSS 变量（docs/decisions.md 第 8 节）。
 *
 * 编辑环境主题属于应用级偏好：只影响写作时的展示，不随项目保存、不改变正文、不产生文档 dirty，
 * 也不影响 Word / PDF 输出（它们有各自的输出参数）。可调整项与入口尚未设计，目前只有默认值。
 *
 * 变量设在编辑器外层元素上：展示参数变化只改变这些变量，不触碰 ProseMirror 文档与视图。
 */

type FontId = 'serif' | 'sans' | 'kai'

/**
 * 字体族对应的 CSS 字体栈（拉丁字体在前、中文字体在后）。
 * 按屏幕阅读挑选，不复用输出字体候选（docs/decisions.md 第 6 节）：可以使用本机字体，不承诺跨机器一致。
 */
export const FONT_STACKS: Readonly<Record<FontId, string>> = {
  serif:
    '"Iowan Old Style", Charter, "Bitstream Charter", Georgia, "Source Han Serif SC", "Noto Serif CJK SC", ' +
    '"Noto Serif SC", "Songti SC", STSong, SimSun, serif',
  sans:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ' +
    '"Noto Sans CJK SC", "Source Han Sans SC", "Noto Sans SC", "WenQuanYi Micro Hei", sans-serif',
  kai: '"Iowan Old Style", Charter, "Bitstream Charter", Georgia, "Kaiti SC", STKaiti, KaiTi, "Noto Serif CJK SC", serif',
}

interface TextStyle {
  readonly font: FontId
  /** 像素（编辑展示只面向屏幕）。 */
  readonly size: number
}

export interface EditorTheme {
  /** lineHeight：相邻两行基线的距离 / 字号；paragraphSpacing：段落之间额外的间距（em）。 */
  readonly body: TextStyle & { readonly lineHeight: number; readonly paragraphSpacing: number }
  /** 第 1、2、3 级章节标题；更深的层级使用第 3 级。正文中没有标题。 */
  readonly headings: readonly [TextStyle, TextStyle, TextStyle]
  readonly quote: TextStyle
  readonly codeSize: number
  readonly tableSize: number
  /** 独立成段的图片前后的间距（em，相对正文字号）。 */
  readonly imageSpacing: number
  readonly caption: TextStyle
}

/**
 * 默认的编辑展示：宋体类正文、无衬线标题、楷体引用。
 * 章节标题字号拉开层级，第 3 级与正文同字号，靠字体与字重区分。
 */
export const DEFAULT_EDITOR_THEME: EditorTheme = {
  body: { font: 'serif', size: 17, lineHeight: 1.78, paragraphSpacing: 0.6 },
  headings: [
    { font: 'sans', size: 26 },
    { font: 'sans', size: 20 },
    { font: 'sans', size: 17 },
  ],
  quote: { font: 'kai', size: 17 },
  codeSize: 14,
  tableSize: 15,
  imageSpacing: 1.6,
  caption: { font: 'serif', size: 14 },
}

const px = (value: number) => `${value}px`
const em = (value: number) => `${value}em`

function text(prefix: string, style: TextStyle): Record<string, string> {
  return { [`--doc-${prefix}-font`]: FONT_STACKS[style.font], [`--doc-${prefix}-size`]: px(style.size) }
}

export function editorThemeCssVars(theme: EditorTheme): Record<string, string> {
  const vars: Record<string, string> = {
    ...text('body', theme.body),
    '--doc-line-height': String(theme.body.lineHeight),
    '--doc-paragraph-spacing': em(theme.body.paragraphSpacing),
    ...text('quote', theme.quote),
    '--doc-code-size': px(theme.codeSize),
    '--doc-table-size': px(theme.tableSize),
    ...text('caption', theme.caption),
    '--doc-image-spacing': em(theme.imageSpacing),
  }
  theme.headings.forEach((heading, index) => {
    Object.assign(vars, text(`h${index + 1}`, heading))
  })
  return vars
}

/** 章节标题的变量（`--heading-*`）：第 depth 级章节使用第 depth 级标题样式，第 3 级及更深共用第 3 级。 */
export function editorHeadingVars(depth: number): Record<string, string> {
  const source = `--doc-h${Math.min(Math.max(depth, 1), 3)}`
  return { '--heading-font': `var(${source}-font)`, '--heading-size': `var(${source}-size)` }
}
