// @vitest-environment node
import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { THEMES } from '../../domain/document_style/document_style.ts'
import { FONT_STACKS, editorHeadingVars, themeCssVars } from './theme_css.ts'

test('主题翻译为 CSS 变量：字号用磅、间距用 em、图片尺寸为正文宽度的比例', () => {
  const vars = themeCssVars(THEMES.book)
  expect(vars['--doc-body-font']).toBe(FONT_STACKS.serif)
  expect(vars['--doc-body-size']).toBe('12pt')
  expect(vars['--doc-line-height']).toBe('1.8')
  expect(vars['--doc-paragraph-spacing']).toBe('0.5em')
  expect(vars['--doc-h1-font']).toBe(FONT_STACKS.sans)
  expect(vars['--doc-h1-size']).toBe('16pt')
  expect(vars['--doc-h3-before']).toBe('1em')
  expect(vars['--doc-table-size']).toBe('11pt')
  expect(vars['--doc-caption-size']).toBe('10pt')
  expect(vars['--doc-image-small']).toBe('40%')
  expect(vars['--doc-image-medium']).toBe('65%')
  expect(vars['--doc-image-large']).toBe('85%')
  expect(vars['--doc-image-full']).toBe('100%')
})

test('编辑器标题变量：章节层级之下叠加正文标题级别，第 3 级及更深共用第 3 级', () => {
  const top = editorHeadingVars(1)
  expect(top['--heading-size']).toBe('var(--doc-h1-size)')
  expect(top['--md-h1-size']).toBe('var(--doc-h2-size)')
  expect(top['--md-h2-before']).toBe('var(--doc-h3-before)')
  const deep = editorHeadingVars(5)
  expect(deep['--heading-font']).toBe('var(--doc-h3-font)')
  expect(deep['--md-h1-size']).toBe('var(--doc-h3-size)')
})

/** Rust export::fonts::families 中某个字体族的候选列表。 */
function rustFamilies(variant: 'Serif' | 'Sans'): string[] {
  const source = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/export/fonts.rs', import.meta.url)), 'utf8')
  const start = source.indexOf(`FontFamily::${variant} => &[`)
  const body = source.slice(start, source.indexOf('],', start))
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1])
}

function cssFamilies(stack: string): string[] {
  return stack
    .split(',')
    .map((name) => name.trim().replace(/^"|"$/g, ''))
    .filter((name) => name !== 'serif' && name !== 'sans-serif')
}

test('CSS 字体栈与 PDF 导出的字体候选顺序一致：同一台机器上选中同一款字体', () => {
  for (const [font, variant] of [
    ['serif', 'Serif'],
    ['sans', 'Sans'],
  ] as const) {
    const rust = rustFamilies(variant)
    const css = cssFamilies(FONT_STACKS[font])
    expect(css.length).toBeGreaterThan(5)
    // CSS 中的每个字体都在 Rust 列表中，且相对顺序相同（Rust 可以多出 Typst 内嵌字体等）。
    const positions = css.map((name) => rust.indexOf(name))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  }
})
