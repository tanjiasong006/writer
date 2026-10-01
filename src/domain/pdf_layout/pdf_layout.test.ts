// @vitest-environment node
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PDF_LAYOUT,
  PDF_LAYOUT_KEYS,
  PDF_LAYOUT_OPTIONS,
  isDefaultPdfLayout,
  isPdfLayoutValue,
  resolvePdfLayout,
  setPdfLayoutOption,
} from './pdf_layout.ts'

test('默认值：每一项都是自己的可选值之一', () => {
  for (const key of PDF_LAYOUT_KEYS) {
    assert.equal(isPdfLayoutValue(key, DEFAULT_PDF_LAYOUT[key]), true, key)
  }
  assert.deepEqual([...PDF_LAYOUT_KEYS].sort(), Object.keys(PDF_LAYOUT_OPTIONS).sort())
})

test('默认值与 Rust 共享：src-tauri/fixtures/pdf_layout_default.json', () => {
  const path = fileURLToPath(new URL('../../../src-tauri/fixtures/pdf_layout_default.json', import.meta.url))
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), DEFAULT_PDF_LAYOUT)
})

test('resolvePdfLayout：改过的项覆盖默认值，其余跟随默认值', () => {
  assert.deepEqual(resolvePdfLayout({}), DEFAULT_PDF_LAYOUT)
  const layout = resolvePdfLayout({ paper: 'b5', toc: false })
  assert.equal(layout.paper, 'b5')
  assert.equal(layout.toc, false)
  assert.equal(layout.margin, DEFAULT_PDF_LAYOUT.margin)
})

test('setPdfLayoutOption：记录改动；改回默认值时不再记录；不变时返回同一对象', () => {
  const changed = setPdfLayoutOption({}, 'paper', 'b5')
  assert.deepEqual(changed, { paper: 'b5' })
  assert.equal(setPdfLayoutOption(changed, 'paper', 'b5'), changed)
  assert.deepEqual(setPdfLayoutOption(changed, 'paper', 'a4'), {})
  const empty = {}
  assert.equal(setPdfLayoutOption(empty, 'paper', 'a4'), empty)
  assert.deepEqual(changed, { paper: 'b5' })
})

test('isPdfLayoutValue：只接受列出的取值', () => {
  assert.equal(isPdfLayoutValue('bodySize', 12), true)
  assert.equal(isPdfLayoutValue('bodySize', '12'), false)
  assert.equal(isPdfLayoutValue('cover', 'yes'), false)
  assert.equal(isPdfLayoutValue('tocDepth', 4), false)
})

test('isDefaultPdfLayout', () => {
  assert.equal(isDefaultPdfLayout({}), true)
  assert.equal(isDefaultPdfLayout({ toc: false }), false)
})
