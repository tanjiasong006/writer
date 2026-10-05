import { expect, test } from 'vitest'
import { chemContent, chemTex } from './chem.ts'

/** 化学式：整个公式是一个 \ce{…}（docs/decisions.md 第 22 节）。 */

test('整个公式是一个 \\ce{…} 时取出内容', () => {
  expect(chemContent('\\ce{2H2 + O2 -> 2H2O}')).toBe('2H2 + O2 -> 2H2O')
  expect(chemContent(' \\ce {Fe^{3+}} ')).toBe('Fe^{3+}')
  expect(chemContent('\\ce{A \\} B}')).toBe('A \\} B')
  expect(chemContent('\\ce{}')).toBe('')
})

test('混有其他内容、不配对或不是 \\ce 时不是化学式', () => {
  expect(chemContent('\\ce{A} + \\ce{B}')).toBeNull()
  expect(chemContent('\\Delta H = \\ce{CO2}')).toBeNull()
  expect(chemContent('\\ce{A')).toBeNull()
  expect(chemContent('\\cent{A}')).toBeNull()
  expect(chemContent('x^2')).toBeNull()
})

test('内容写成公式；空内容是空公式', () => {
  expect(chemTex(' H2O ')).toBe('\\ce{H2O}')
  expect(chemTex('  ')).toBe('')
})
