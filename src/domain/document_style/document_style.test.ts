// @vitest-environment node
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  THEMES,
  defaultDocumentStyle,
  effectiveImageLayout,
  headingStyle,
  imageKey,
  isDefaultStyle,
  overrideStyle,
  resetOverrides,
  resolveTheme,
  selectTheme,
  setImageLayout,
  type DocumentStyle,
} from './document_style.ts'

const fixtures = fileURLToPath(new URL('../../../src-tauri/fixtures/', import.meta.url))

test('默认样式：默认主题、没有调整与图片布局', () => {
  const style = defaultDocumentStyle()
  assert.equal(style.theme, 'book')
  assert.ok(isDefaultStyle(style))
  assert.deepEqual(resolveTheme(style), THEMES.book)
})

test('默认主题与 Rust 测试共用的 fixture 一致（两侧不会各自维护一套数字）', () => {
  const fixture = JSON.parse(readFileSync(`${fixtures}default-theme.json`, 'utf8'))
  assert.deepEqual(resolveTheme(defaultDocumentStyle()), fixture)
})

test('resolveTheme：调整覆盖主题中对应的字段，标题字体同时作用于文档标题', () => {
  const style = overrideStyle(defaultDocumentStyle(), {
    bodyFont: 'sans',
    bodySize: 10.5,
    lineHeight: 1.6,
    headingFont: 'serif',
    heading2Size: 15,
  })
  const theme = resolveTheme(style)
  assert.deepEqual(theme.body, { font: 'sans', size: 10.5, lineHeight: 1.6, paragraphSpacing: 0.5 })
  assert.equal(theme.title.font, 'serif')
  assert.equal(theme.heading1.font, 'serif')
  assert.equal(theme.heading1.size, 16)
  assert.equal(theme.heading2.size, 15)
  assert.equal(theme.heading3.font, 'serif')
  // 其余元素仍来自主题。
  assert.deepEqual(theme.caption, THEMES.book.caption)
})

test('headingStyle：第 3 级及更深的标题使用第 3 级样式', () => {
  const theme = THEMES.book
  assert.equal(headingStyle(theme, 1), theme.heading1)
  assert.equal(headingStyle(theme, 2), theme.heading2)
  assert.equal(headingStyle(theme, 3), theme.heading3)
  assert.equal(headingStyle(theme, 7), theme.heading3)
})

test('overrideStyle：与主题相同的值或 undefined 去掉调整；非法值被忽略；不变时返回同一对象', () => {
  const base = defaultDocumentStyle()
  const changed = overrideStyle(base, { bodySize: 14 })
  assert.deepEqual(changed.overrides, { bodySize: 14 })
  assert.deepEqual(overrideStyle(changed, { bodySize: 12 }).overrides, {})
  assert.deepEqual(overrideStyle(changed, { bodySize: undefined }).overrides, {})
  assert.equal(overrideStyle(base, { bodySize: 500, lineHeight: Number.NaN }), base)
  assert.equal(overrideStyle(base, { bodyFont: 'comic' as never }), base)
  assert.equal(overrideStyle(changed, { bodySize: 14 }), changed)
})

test('selectTheme：切换主题清除调整、保留图片布局', () => {
  let style: DocumentStyle = overrideStyle(defaultDocumentStyle(), { bodySize: 14 })
  style = setImageLayout(style, 'assets/a.png', { size: 'small' })
  const next = selectTheme(style, 'technical')
  assert.equal(next.theme, 'technical')
  assert.deepEqual(next.overrides, {})
  assert.equal(next.images, style.images)
  assert.equal(resolveTheme(next).body.font, 'sans')
  assert.equal(selectTheme(next, 'technical'), next)
  assert.equal(resetOverrides(next), next)
  assert.deepEqual(resetOverrides(style).overrides, {})
})

test('setImageLayout：按图片文件键记录，null 或空布局去掉记录，不变时返回同一对象', () => {
  const base = defaultDocumentStyle()
  const large = setImageLayout(base, 'assets/a.png', { size: 'large' })
  assert.deepEqual([...large.images], [['assets/a.png', { size: 'large' }]])
  assert.equal(base.images.size, 0, '不修改输入')
  assert.equal(setImageLayout(large, 'assets/a.png', { size: 'large' }), large)
  const both = setImageLayout(large, 'assets/b.png', { align: 'left' })
  assert.equal(both.images.size, 2)
  assert.equal(setImageLayout(both, 'assets/a.png', null).images.has('assets/a.png'), false)
  assert.equal(setImageLayout(both, 'assets/a.png', {}).images.has('assets/a.png'), false)
  assert.equal(setImageLayout(base, 'assets/x.png', null), base)
  assert.equal(isDefaultStyle(large), false)
})

test('effectiveImageLayout：图片自己的设置优先，其余跟随主题', () => {
  assert.deepEqual(effectiveImageLayout(THEMES.book, undefined), { size: 'original', align: 'center' })
  assert.deepEqual(effectiveImageLayout(THEMES.technical, undefined), { size: 'large', align: 'center' })
  assert.deepEqual(effectiveImageLayout(THEMES.book, { align: 'right' }), { size: 'original', align: 'right' })
  assert.deepEqual(effectiveImageLayout(THEMES.book, { size: 'full', align: 'left' }), { size: 'full', align: 'left' })
})

test('imageKey：与 Rust 共用的用例', () => {
  const { cases } = JSON.parse(readFileSync(`${fixtures}image-keys.json`, 'utf8')) as {
    cases: Array<[string, string | null]>
  }
  for (const [reference, key] of cases) assert.equal(imageKey(reference), key, reference)
})
