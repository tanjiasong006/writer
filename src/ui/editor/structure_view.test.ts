import { expect, test } from 'vitest'
import { drawStructure, isValidSmiles, smilesProblem } from './structure_view.ts'
import { NO_CONDITIONS } from './markdown.ts'

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
  const drawing = drawStructure('CCO.CC(=O)O>OS(=O)(=O)O>CCOC(C)=O.O', 'print', { ...NO_CONDITIONS, arrow: '<=>', above: '催化', below: '△' })
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
  const arrow = drawStructure('C=C.BrBr>CCCCCl>BrCCBr', 'text')
  if ('error' in arrow) throw new Error(arrow.error)
  expect(arrow.svg.querySelectorAll(':scope > line')).toHaveLength(1)
  expect(arrow.svg.querySelectorAll(':scope > path')).toHaveLength(1)
  expect([...arrow.svg.querySelectorAll(':scope > text')].map((text) => text.textContent)).toContain('C₄H₉Cl')
  const equals = drawStructure('C=C.BrBr>>BrCCBr', 'text', { ...NO_CONDITIONS, arrow: '=' })
  if ('error' in equals) throw new Error(equals.error)
  expect(equals.svg.querySelectorAll(':scope > line')).toHaveLength(2)
  expect(equals.svg.querySelectorAll(':scope > path')).toHaveLength(0)
})

test('写法不对的反应式给出说明', () => {
  const drawing = drawStructure('CCO>C=C')
  expect('error' in drawing && drawing.error).toContain('反应物>试剂>产物')
})

test('SMILES 无法画出的原因与位置：括号不配对、不能出现的字符、连续的键、没有写完', () => {
  expect(smilesProblem('CCO')).toBeNull()
  expect(smilesProblem('CC(C(C)C')).toEqual({ message: '“(”没有对应的“)”', at: { start: 2, end: 3 } })
  expect(smilesProblem('CC)C')).toEqual({ message: '多了一个“)”', at: { start: 2, end: 3 } })
  expect(smilesProblem('C[NH4+')).toEqual({ message: '“[”没有对应的“]”', at: { start: 1, end: 2 } })
  expect(smilesProblem('CC]')).toEqual({ message: '多了一个“]”', at: { start: 2, end: 3 } })
  expect(smilesProblem('CCq')).toEqual({ message: '这里不能写“q”', at: { start: 2, end: 3 } })
  expect(smilesProblem('CC==C')).toEqual({ message: '连续写了两个键', at: { start: 3, end: 4 } })
  expect(smilesProblem('CC%')).toEqual({ message: '还没有写完', at: { start: 3, end: 3 } })
})

test('分子的方向：顺时针旋转；左右翻转时原子符号仍是正的，楔形键实、虚互换（同一个构型）；反应式不旋转', () => {
  const draw = (smiles: string, rotate: number, flip = false) => {
    const drawing = drawStructure(smiles, 'print', { ...NO_CONDITIONS, rotate, flip })
    if ('error' in drawing) throw new Error(drawing.error)
    return drawing
  }
  const chain = draw('CCCCCC', 0)
  const turned = draw('CCCCCC', 90)
  expect(turned.width).toBeCloseTo(chain.height)
  expect(turned.height).toBeCloseTo(chain.width)

  // 正丁醇：羟基在右端时写作“HO”向左对齐的末端，翻转后在左端写作“OH”。
  const label = (smiles: string, flip: boolean) => draw(smiles, 0, flip).svg.querySelector('text.element')?.textContent
  expect(label('CCCCO', false)).toBe('HO')
  expect(label('CCCCO', true)).toBe('OH')

  const wedges = (flip: boolean) => draw('C[C@H](O)CC', 0, flip).svg.querySelectorAll('polygon').length
  expect(wedges(false)).toBe(1)
  expect(wedges(true)).toBe(0)

  const reaction = drawStructure('CCCCCC>>CCCCCC', 'print', { ...NO_CONDITIONS, rotate: 90 })
  const upright = drawStructure('CCCCCC>>CCCCCC', 'print')
  if ('error' in reaction || 'error' in upright) throw new Error('reaction')
  expect(reaction.width).toBeCloseTo(upright.width)
})
