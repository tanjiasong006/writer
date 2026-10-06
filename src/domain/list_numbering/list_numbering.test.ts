// @vitest-environment node
import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_LIST_NUMBERING, LIST_NUMBERINGS, formatListMarker, isListNumbering } from './list_numbering.ts'

test('编号文字与 Rust（Typst 的编号规则）共享：src-tauri/fixtures/list_numbering.json', () => {
  const path = fileURLToPath(new URL('../../../src-tauri/fixtures/list_numbering.json', import.meta.url))
  const cases = JSON.parse(readFileSync(path, 'utf8')) as Array<[string, number, string]>
  for (const [numbering, n, expected] of cases) {
    expect(isListNumbering(numbering), numbering).toBe(true)
    expect(formatListMarker(numbering as never, n), `${numbering} ${n}`).toBe(expected)
  }
  // 每种样式都有用例。
  expect(new Set(cases.map(([numbering]) => numbering))).toEqual(new Set(LIST_NUMBERINGS))
})

test('样式的第 1 项就是样式本身', () => {
  for (const numbering of LIST_NUMBERINGS) expect(formatListMarker(numbering, 1)).toBe(numbering)
  expect(DEFAULT_LIST_NUMBERING).toBe('1.')
})

test('不认识的写法不是样式', () => {
  for (const value of ['', '1', '2.', '一', 'x.', ' 1.', null, 1]) expect(isListNumbering(value)).toBe(false)
})
