import {
  IMAGE_WIDTH_RATIO,
  type DocumentTheme,
  type FontId,
  type HeadingStyle,
  type TextStyle,
} from '../../domain/document_style/document_style.ts'

/**
 * 文档主题 → CSS 变量。编辑器与全文预览共用这一份翻译（Word / PDF 的翻译在 Rust export 中），
 * 组件的样式只引用这些变量，不写死字体、字号、行距。
 *
 * 变量设在编辑器 / 预览的外层元素上：主题变化只改变这些变量，不触碰 ProseMirror 文档与视图。
 */

/**
 * 字体族对应的 CSS 字体栈：与 Rust `export::fonts::families` 顺序一致（拉丁字体在前、中文字体在后），
 * 编辑器、预览与 PDF 在同一台机器上选中的是同一款字体。
 */
export const FONT_STACKS: Readonly<Record<FontId, string>> = {
  serif:
    '"Times New Roman", "Liberation Serif", "DejaVu Serif", "Songti SC", STSong, SimSun, NSimSun, ' +
    '"Noto Serif CJK SC", "Source Han Serif SC", "Noto Serif SC", serif',
  sans:
    'Arial, Helvetica, "Liberation Sans", "DejaVu Sans", "Heiti SC", STHeiti, "PingFang SC", SimHei, ' +
    '"Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "Noto Sans SC", "WenQuanYi Micro Hei", sans-serif',
}

const pt = (value: number) => `${value}pt`
const em = (value: number) => `${value}em`
const percent = (ratio: number) => `${Math.round(ratio * 1000) / 10}%`

function text(prefix: string, style: TextStyle): Record<string, string> {
  return { [`--doc-${prefix}-font`]: FONT_STACKS[style.font], [`--doc-${prefix}-size`]: pt(style.size) }
}

function heading(level: 1 | 2 | 3, style: HeadingStyle): Record<string, string> {
  return {
    ...text(`h${level}`, style),
    [`--doc-h${level}-before`]: em(style.spacingBefore),
    [`--doc-h${level}-after`]: em(style.spacingAfter),
  }
}

export function themeCssVars(theme: DocumentTheme): Record<string, string> {
  return {
    ...text('body', theme.body),
    '--doc-line-height': String(theme.body.lineHeight),
    '--doc-paragraph-spacing': em(theme.body.paragraphSpacing),
    ...text('title', theme.title),
    ...heading(1, theme.heading1),
    ...heading(2, theme.heading2),
    ...heading(3, theme.heading3),
    ...text('quote', theme.blockquote),
    '--doc-code-size': pt(theme.codeBlock.size),
    '--doc-table-size': pt(theme.table.size),
    ...text('caption', theme.caption),
    '--doc-image-spacing': em(theme.image.spacing),
    '--doc-image-small': percent(IMAGE_WIDTH_RATIO.small),
    '--doc-image-medium': percent(IMAGE_WIDTH_RATIO.medium),
    '--doc-image-large': percent(IMAGE_WIDTH_RATIO.large),
    '--doc-image-full': percent(IMAGE_WIDTH_RATIO.full),
  }
}

/** 第 level 级标题使用的主题变量组（第 3 级及更深使用 h3，与 domain `headingStyle` 一致）。 */
function headingVarLevel(level: number): 1 | 2 | 3 {
  return level <= 1 ? 1 : level === 2 ? 2 : 3
}

/**
 * 编辑器中标题的变量：章节标题是第 depth 级；正文中的 # … ###### 叠加在章节层级之下
 * （第 depth + n 级，与预览 / 导出一致）。`--heading-*` 给章节标题，`--md-hN-*` 给正文第 N 级标题。
 */
export function editorHeadingVars(depth: number): Record<string, string> {
  const vars: Record<string, string> = {}
  const assign = (prefix: string, level: number) => {
    const source = `--doc-h${headingVarLevel(level)}`
    for (const part of ['font', 'size', 'before', 'after']) vars[`${prefix}-${part}`] = `var(${source}-${part})`
  }
  assign('--heading', depth)
  for (let n = 1; n <= 6; n++) assign(`--md-h${n}`, depth + n)
  return vars
}
