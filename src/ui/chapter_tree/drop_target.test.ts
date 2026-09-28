import { expect, test } from 'vitest'
import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX_STEP,
  autoScrollStep,
  resolveDropPosition,
} from './drop_target.ts'

// 目标行：top=100、height=30，四分边界在 107.5 与 122.5。
const row = { top: 100, height: 30 }

test('行上 25% 判定为 before', () => {
  expect(resolveDropPosition(100, row)).toBe('before')
  expect(resolveDropPosition(105, row)).toBe('before')
  expect(resolveDropPosition(107.49, row)).toBe('before')
})

test('行中间 50% 判定为 inside', () => {
  expect(resolveDropPosition(107.5, row)).toBe('inside')
  expect(resolveDropPosition(115, row)).toBe('inside')
  expect(resolveDropPosition(122.49, row)).toBe('inside')
})

test('行下 25% 判定为 after', () => {
  expect(resolveDropPosition(122.5, row)).toBe('after')
  expect(resolveDropPosition(125, row)).toBe('after')
  expect(resolveDropPosition(130, row)).toBe('after')
})

test('四分边界归入其下方区域', () => {
  const height = row.height
  expect(resolveDropPosition(row.top + height * 0.25, row)).toBe('inside')
  expect(resolveDropPosition(row.top + height * 0.75, row)).toBe('after')
})

test('inside 区域最大，占行高一半', () => {
  const height = row.height
  const before = resolveDropPosition(row.top + height * 0.2, row)
  const inside = resolveDropPosition(row.top + height * 0.5, row)
  const after = resolveDropPosition(row.top + height * 0.8, row)
  expect([before, inside, after]).toEqual(['before', 'inside', 'after'])
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

test('不同行高按各自四分判定，边界随之移动', () => {
  const tall = { top: 0, height: 80 }
  expect(resolveDropPosition(19.99, tall)).toBe('before')
  expect(resolveDropPosition(20, tall)).toBe('inside')
  expect(resolveDropPosition(59.99, tall)).toBe('inside')
  expect(resolveDropPosition(60, tall)).toBe('after')
})

test('autoScrollStep：只在靠近上下边缘时滚动，越靠近越快', () => {
  const container = { top: 100, height: 400 }
  expect(autoScrollStep(300, container)).toBe(0)
  expect(autoScrollStep(100 + AUTO_SCROLL_EDGE, container)).toBe(0)
  expect(autoScrollStep(100, container)).toBe(-AUTO_SCROLL_MAX_STEP)
  expect(autoScrollStep(500, container)).toBe(AUTO_SCROLL_MAX_STEP)
  expect(autoScrollStep(130, container)).toBeLessThan(0)
  expect(autoScrollStep(130, container)).toBeGreaterThan(autoScrollStep(110, container))
  expect(autoScrollStep(480, container)).toBeGreaterThan(0)
})
