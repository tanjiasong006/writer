import { expect, test } from 'vitest'
import { drawStructure, isValidSmiles } from './structure_view.ts'

/** 化学结构式的画法：分子与反应式（docs/decisions.md 第 22 节）。 */

test('有效的 SMILES：分子、反应式（反应物>试剂>产物）；写法不对的反应式无效', () => {
  expect(isValidSmiles('CCO')).toBe(true)
  expect(isValidSmiles('CCO.CC(=O)O>>CCOC(C)=O.O')).toBe(true)
  expect(isValidSmiles('CCO>OS(=O)(=O)O>C=C.O')).toBe(true)
  expect(isValidSmiles('CCO>C=C')).toBe(false)
  expect(isValidSmiles('>>C')).toBe(false)
  expect(isValidSmiles('CCO>>C1CC(')).toBe(false)
  expect(isValidSmiles(' ')).toBe(false)
})

test('反应式：每个分子分别画出，以＋相连；箭头与上下的条件，试剂写在箭头上方', () => {
  const drawing = drawStructure('CCO.CC(=O)O>OS(=O)(=O)O>CCOC(C)=O.O', 'print', { arrow: '<=>', above: '催化', below: '△' })
  if ('error' in drawing) throw new Error(drawing.error)
  const texts = [...drawing.svg.querySelectorAll(':scope > text')].map((text) => text.textContent)
  expect(texts).toEqual(['+', '硫酸，催化', '△', '+'])
  // 两个反应物与乙酸乙酯画成骨架，水写成化学式。
  expect(drawing.svg.querySelectorAll(':scope > svg')).toHaveLength(4)
  expect(drawing.svg.textContent).toContain('H₂O')
  // ⇌ 是两条线与两个半箭头。
  expect(drawing.svg.querySelectorAll(':scope > line')).toHaveLength(2)
  expect(drawing.svg.querySelectorAll(':scope > path')).toHaveLength(2)
})

test('箭头：→ 是一条线加箭头，＝ 是两条平行线；不在库中的试剂写分子式', () => {
  const arrow = drawStructure('C=C.BrBr>CCCl>BrCCBr', 'text')
  if ('error' in arrow) throw new Error(arrow.error)
  expect(arrow.svg.querySelectorAll(':scope > line')).toHaveLength(1)
  expect(arrow.svg.querySelectorAll(':scope > path')).toHaveLength(1)
  expect([...arrow.svg.querySelectorAll(':scope > text')].map((text) => text.textContent)).toContain('C₂H₅Cl')
  const equals = drawStructure('C=C.BrBr>>BrCCBr', 'text', { arrow: '=', above: '', below: '' })
  if ('error' in equals) throw new Error(equals.error)
  expect(equals.svg.querySelectorAll(':scope > line')).toHaveLength(2)
  expect(equals.svg.querySelectorAll(':scope > path')).toHaveLength(0)
})

test('写法不对的反应式给出说明', () => {
  const drawing = drawStructure('CCO>C=C')
  expect('error' in drawing && drawing.error).toContain('反应物>试剂>产物')
})
