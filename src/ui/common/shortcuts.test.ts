import { expect, test } from 'vitest'
import { formatShortcut } from './shortcuts.ts'

test('macOS 用符号并按 ⌃⌥⇧⌘ 排列', () => {
  expect(formatShortcut('CmdOrCtrl+Shift+N', true)).toBe('⇧⌘N')
  expect(formatShortcut('Alt+Shift+ArrowUp', true)).toBe('⌥⇧↑')
  expect(formatShortcut('Ctrl+CmdOrCtrl+S', true)).toBe('⌃⌘S')
  expect(formatShortcut('F2', true)).toBe('F2')
})

test('其他平台写成 Ctrl+Shift+N', () => {
  expect(formatShortcut('CmdOrCtrl+Shift+N', false)).toBe('Ctrl+Shift+N')
  expect(formatShortcut('Alt+Shift+ArrowLeft', false)).toBe('Alt+Shift+←')
  expect(formatShortcut('CmdOrCtrl+b', false)).toBe('Ctrl+B')
})
