// @vitest-environment node
import { expect, test } from 'vitest'
import { DEFAULT_EDITOR_THEME, FONT_STACKS, editorHeadingVars, editorThemeCssVars } from './editor_theme.ts'

test('默认展示参数翻译为 CSS 变量：字号用像素、间距用 em', () => {
  const vars = editorThemeCssVars(DEFAULT_EDITOR_THEME)
  expect(vars['--doc-body-font']).toBe(FONT_STACKS.serif)
  expect(vars['--doc-body-size']).toBe('17px')
  expect(vars['--doc-line-height']).toBe('1.78')
  expect(vars['--doc-paragraph-spacing']).toBe('0.6em')
  expect(vars['--doc-h1-font']).toBe(FONT_STACKS.sans)
  expect(vars['--doc-quote-font']).toBe(FONT_STACKS.kai)
  expect(vars['--doc-h1-size']).toBe('26px')
  expect(vars['--doc-table-size']).toBe('15px')
  expect(vars['--doc-caption-size']).toBe('14px')
  expect(vars['--doc-image-spacing']).toBe('1.6em')
  // 没有单张图片的尺寸档位。
  expect(Object.keys(vars).some((name) => name.startsWith('--doc-image-') && name !== '--doc-image-spacing')).toBe(false)
})

test('章节标题变量：第 depth 级章节用第 depth 级样式，第 3 级及更深共用第 3 级；正文没有标题变量', () => {
  expect(editorHeadingVars(1)).toEqual({ '--heading-font': 'var(--doc-h1-font)', '--heading-size': 'var(--doc-h1-size)' })
  expect(editorHeadingVars(5)['--heading-font']).toBe('var(--doc-h3-font)')
})
