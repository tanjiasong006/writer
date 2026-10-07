import { expect, test } from 'vitest'
import { ELEMENTS } from './periodic_table.ts'

const at = (symbol: string) => {
  const element = ELEMENTS.find((item) => item.symbol === symbol)
  return element && `${element.number} ${element.name} ${element.row},${element.column}`
}

test('118 种元素，每个都有中文名称，位置不重叠', () => {
  expect(ELEMENTS).toHaveLength(118)
  expect(ELEMENTS.every((element) => [...element.name].length === 1)).toBe(true)
  expect(new Set(ELEMENTS.map((element) => `${element.row},${element.column}`)).size).toBe(118)
})

test('按周期与族排列，镧系与锕系单独排在下方', () => {
  expect(at('H')).toBe('1 氢 1,1')
  expect(at('He')).toBe('2 氦 1,18')
  expect(at('B')).toBe('5 硼 2,13')
  expect(at('Sc')).toBe('21 钪 4,3')
  expect(at('Fe')).toBe('26 铁 4,8')
  expect(at('La')).toBe('57 镧 9,3')
  expect(at('Lu')).toBe('71 镥 9,17')
  expect(at('Hf')).toBe('72 铪 6,4')
  expect(at('Rn')).toBe('86 氡 6,18')
  expect(at('Ac')).toBe('89 锕 10,3')
  expect(at('Rf')).toBe('104 𬬻 7,4')
  expect(at('Og')).toBe('118 鿫 7,18')
})
