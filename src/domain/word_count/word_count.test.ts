import { expect, test } from 'vitest'
import { addCounts, countText } from './word_count.ts'

test('汉字与中文标点逐字计数', () => {
  expect(countText('长文档写作。')).toEqual({ words: 6, characters: 6 })
  expect(countText('“引号”——破折号…')).toEqual({ words: 10, characters: 10 })
})

test('西文按词计数，词内的撇号与连字符不拆开，半角标点不计', () => {
  expect(countText("Writer's long-form editor, v2.")).toEqual({ words: 4, characters: 27 })
})

test('中西混排：汉字逐字，西文与数字按词', () => {
  expect(countText('使用 Typst 排版 2026 年')).toEqual({ words: 7, characters: 14 })
})

test('空白不计入字符数', () => {
  expect(countText(' \n\t　')).toEqual({ words: 0, characters: 0 })
  expect(countText('')).toEqual({ words: 0, characters: 0 })
})

test('addCounts', () => {
  expect(addCounts({ words: 1, characters: 2 }, { words: 3, characters: 4 })).toEqual({ words: 4, characters: 6 })
})
