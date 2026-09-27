import { expect, test } from 'vitest'
import { resolveDropPosition } from './drop_target.ts'

// 目标行：top=100、height=30，三等分边界在 110 与 120。
const row = { top: 100, height: 30 }

test('行上 1/3 判定为 before', () => {
  expect(resolveDropPosition(100, row)).toBe('before')
  expect(resolveDropPosition(105, row)).toBe('before')
  expect(resolveDropPosition(109.99, row)).toBe('before')
})

test('行中间 1/3 判定为 inside', () => {
  expect(resolveDropPosition(110, row)).toBe('inside')
  expect(resolveDropPosition(115, row)).toBe('inside')
  expect(resolveDropPosition(119.99, row)).toBe('inside')
})

test('行下 1/3 判定为 after', () => {
  expect(resolveDropPosition(120, row)).toBe('after')
  expect(resolveDropPosition(125, row)).toBe('after')
  expect(resolveDropPosition(130, row)).toBe('after')
})

test('三等分边界归入其下方区域', () => {
  const height = row.height
  expect(resolveDropPosition(row.top + height / 3, row)).toBe('inside')
  expect(resolveDropPosition(row.top + (height * 2) / 3, row)).toBe('after')
})

test('行上方与下方分别归入 before 与 after', () => {
  expect(resolveDropPosition(0, row)).toBe('before')
  expect(resolveDropPosition(99, row)).toBe('before')
  expect(resolveDropPosition(131, row)).toBe('after')
  expect(resolveDropPosition(1000, row)).toBe('after')
})

test('结果只取决于相对位置，与行的绝对偏移无关', () => {
  const shifted = { top: 500, height: 30 }
  expect(resolveDropPosition(505, shifted)).toBe('before')
  expect(resolveDropPosition(515, shifted)).toBe('inside')
  expect(resolveDropPosition(525, shifted)).toBe('after')
})

test('不同行高按各自三等分判定，边界随之移动', () => {
  const tall = { top: 0, height: 90 }
  expect(resolveDropPosition(29.99, tall)).toBe('before')
  expect(resolveDropPosition(30, tall)).toBe('inside')
  expect(resolveDropPosition(59.99, tall)).toBe('inside')
  expect(resolveDropPosition(60, tall)).toBe('after')
})
