/**
 * 编辑环境的正文展示参数 → CSS 变量（docs/decisions.md 第 8 节）。
 *
 * 编辑环境主题属于应用级偏好：只影响写作时的展示，不随项目保存、不改变正文、不产生文档 dirty，
 * 也不影响 Word / PDF 输出（它们有各自的输出参数）。可调整项与入口尚未设计，目前只有默认值。
 *
 * 变量设在编辑器外层元素上：展示参数变化只改变这些变量，不触碰 ProseMirror 文档与视图。
 */

type FontId = 'serif' | 'sans'

/** 字体族对应的 CSS 字体栈（拉丁字体在前、中文字体在后）。 */
export const FONT_STACKS: Readonly<Record<FontId, string>> = {
  serif:
    '"Times New Roman", "Liberation Serif", "DejaVu Serif", "Songti SC", STSong, SimSun, NSimSun, ' +
    '"Noto Serif CJK SC", "Source Han Serif SC", "Noto Serif SC", serif',
  sans:
    'Arial, Helvetica, "Liberation Sans", "DejaVu Sans", "Heiti SC", STHeiti, "PingFang SC", SimHei, ' +
    '"Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "Noto Sans SC", "WenQuanYi Micro Hei", sans-serif',
}

interface TextStyle {
  readonly font: FontId
  /** 磅。 */
  readonly size: number
}

interface HeadingStyle extends TextStyle {
  /** 标题前后的间距（em，相对标题字号）。 */
  readonly before: number
  readonly after: number
}

export interface EditorTheme {
  /** lineHeight：相邻两行基线的距离 / 字号；paragraphSpacing：段落之间额外的间距（em）。 */
  readonly body: TextStyle & { readonly lineHeight: number; readonly paragraphSpacing: number }
  /** 第 1、2、3 级标题；更深的层级使用第 3 级。 */
  readonly headings: readonly [HeadingStyle, HeadingStyle, HeadingStyle]
  readonly quote: TextStyle
  readonly codeSize: number
  readonly tableSize: number
  /** 独立成段的图片前后的间距（em，相对正文字号）。 */
  readonly imageSpacing: number
  readonly caption: TextStyle
}

/** 默认的编辑展示：宋体类正文、黑体类标题，舒适的行距。 */
export const DEFAULT_EDITOR_THEME: EditorTheme = {
  body: { font: 'serif', size: 12, lineHeight: 1.8, paragraphSpacing: 0.5 },
  headings: [
    { font: 'sans', size: 16, before: 1.4, after: 0.6 },
    { font: 'sans', size: 14, before: 1.2, after: 0.5 },
    { font: 'sans', size: 13, before: 1, after: 0.4 },
  ],
  quote: { font: 'serif', size: 12 },
  codeSize: 10,
  tableSize: 11,
  imageSpacing: 1,
  caption: { font: 'serif', size: 10 },
}

const pt = (value: number) => `${value}pt`
const em = (value: number) => `${value}em`

function text(prefix: string, style: TextStyle): Record<string, string> {
  return { [`--doc-${prefix}-font`]: FONT_STACKS[style.font], [`--doc-${prefix}-size`]: pt(style.size) }
}

export function editorThemeCssVars(theme: EditorTheme): Record<string, string> {
  const vars: Record<string, string> = {
    ...text('body', theme.body),
    '--doc-line-height': String(theme.body.lineHeight),
    '--doc-paragraph-spacing': em(theme.body.paragraphSpacing),
    ...text('quote', theme.quote),
    '--doc-code-size': pt(theme.codeSize),
    '--doc-table-size': pt(theme.tableSize),
    ...text('caption', theme.caption),
    '--doc-image-spacing': em(theme.imageSpacing),
  }
  theme.headings.forEach((heading, index) => {
    Object.assign(vars, text(`h${index + 1}`, heading), {
      [`--doc-h${index + 1}-before`]: em(heading.before),
      [`--doc-h${index + 1}-after`]: em(heading.after),
    })
  })
  return vars
}

/**
 * 标题的变量：章节标题是第 depth 级；正文中的 # … ###### 叠加在章节层级之下（第 depth + n 级）。
 * `--heading-*` 给章节标题，`--md-hN-*` 给正文第 N 级标题；第 3 级及更深共用第 3 级。
 */
export function editorHeadingVars(depth: number): Record<string, string> {
  const vars: Record<string, string> = {}
  const assign = (prefix: string, level: number) => {
    const source = `--doc-h${Math.min(Math.max(level, 1), 3)}`
    for (const part of ['font', 'size', 'before', 'after']) vars[`${prefix}-${part}`] = `var(${source}-${part})`
  }
  assign('--heading', depth)
  for (let n = 1; n <= 6; n++) assign(`--md-h${n}`, depth + n)
  return vars
}
