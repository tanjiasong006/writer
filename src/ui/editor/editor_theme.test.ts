// @vitest-environment node
import { expect, test } from 'vitest'
import { DEFAULT_EDITOR_THEME, FONT_STACKS, editorHeadingVars, editorThemeCssVars } from './editor_theme.ts'

test('默认展示参数翻译为 CSS 变量：字号用磅、间距用 em', () => {
  const vars = editorThemeCssVars(DEFAULT_EDITOR_THEME)
  expect(vars['--doc-body-font']).toBe(FONT_STACKS.serif)
  expect(vars['--doc-body-size']).toBe('12pt')
  expect(vars['--doc-line-height']).toBe('1.8')
  expect(vars['--doc-paragraph-spacing']).toBe('0.5em')
  expect(vars['--doc-h1-font']).toBe(FONT_STACKS.sans)
  expect(vars['--doc-h1-size']).toBe('16pt')
  expect(vars['--doc-h3-before']).toBe('1em')
  expect(vars['--doc-table-size']).toBe('11pt')
  expect(vars['--doc-caption-size']).toBe('10pt')
  expect(vars['--doc-image-spacing']).toBe('1em')
  // 没有单张图片的尺寸档位。
  expect(Object.keys(vars).some((name) => name.startsWith('--doc-image-') && name !== '--doc-image-spacing')).toBe(false)
})

test('标题变量：章节层级之下叠加正文标题级别，第 3 级及更深共用第 3 级', () => {
  const top = editorHeadingVars(1)
  expect(top['--heading-size']).toBe('var(--doc-h1-size)')
  expect(top['--md-h1-size']).toBe('var(--doc-h2-size)')
  expect(top['--md-h2-before']).toBe('var(--doc-h3-before)')
  const deep = editorHeadingVars(5)
  expect(deep['--heading-font']).toBe('var(--doc-h3-font)')
  expect(deep['--md-h1-size']).toBe('var(--doc-h3-size)')
})
