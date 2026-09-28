import { expect, test } from 'vitest'
import { createChapterState, detectLineSeparator, readText } from './editor_state.ts'

test('detectLineSeparator：只有纯 CRLF 文件使用 CRLF', () => {
  expect(detectLineSeparator('a\nb')).toBeNull()
  expect(detectLineSeparator('a\r\nb\r\n')).toBe('\r\n')
  expect(detectLineSeparator('a\r\nb\nc')).toBeNull()
  expect(detectLineSeparator('a\r\nb\rc')).toBeNull()
  expect(detectLineSeparator('')).toBeNull()
})

test('未编辑时读回的正文与载入时逐字节一致', () => {
  for (const text of [
    '',
    '# 标题\n\n正文\n',
    '无结尾换行',
    'Windows\r\n换行\r\n',
    '﻿带 BOM 的正文\n',
    '行尾空格  \n\t缩进\n\n\n',
    '中文、English、emoji 🎉、組合字 é\n',
  ]) {
    expect(readText(createChapterState(text, []))).toBe(text)
  }
})

test('CRLF 文件编辑后仍保持 CRLF', () => {
  const state = createChapterState('第一行\r\n第二行\r\n', [])
  const edited = state.update({ changes: { from: state.doc.line(2).to, insert: '（补充）' } }).state
  expect(readText(edited)).toBe('第一行\r\n第二行（补充）\r\n')
})
