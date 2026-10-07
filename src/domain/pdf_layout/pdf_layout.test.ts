// @vitest-environment node
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PDF_LAYOUT,
  PDF_LAYOUT_KEYS,
  PDF_LAYOUT_OPTIONS,
  PDF_LAYOUT_PRESETS,
  PDF_LAYOUT_PRESET_IDS,
  isDefaultPdfLayout,
  isPdfLayoutValue,
  matchPdfLayoutPreset,
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

test('内置版式：只含与默认值不同的合法项，彼此不同', () => {
  for (const id of PDF_LAYOUT_PRESET_IDS) {
    for (const [key, value] of Object.entries(PDF_LAYOUT_PRESETS[id])) {
      const k = key as keyof typeof DEFAULT_PDF_LAYOUT
      assert.equal(isPdfLayoutValue(k, value), true, `${id}.${key}`)
      assert.notEqual(value, DEFAULT_PDF_LAYOUT[k], `${id}.${key}`)
    }
  }
  assert.deepEqual(PDF_LAYOUT_PRESETS.standard, {})
  const matched = PDF_LAYOUT_PRESET_IDS.map((id) => matchPdfLayoutPreset(PDF_LAYOUT_PRESETS[id]))
  assert.deepEqual(matched, PDF_LAYOUT_PRESET_IDS)
})

test('matchPdfLayoutPreset：按合并后的完整配置比较；改过任一项后不再匹配', () => {
  assert.equal(matchPdfLayoutPreset({}), 'standard')
  // 显式写出默认值的项不影响匹配。
  assert.equal(matchPdfLayoutPreset({ paper: 'a4' }), 'standard')
  assert.equal(matchPdfLayoutPreset({ ...PDF_LAYOUT_PRESETS.academic, margin: 'normal' }), 'academic')
  assert.equal(matchPdfLayoutPreset({ ...PDF_LAYOUT_PRESETS.book, paper: 'a5' }), null)
  assert.equal(matchPdfLayoutPreset({ paper: 'b5' }), null)
})
