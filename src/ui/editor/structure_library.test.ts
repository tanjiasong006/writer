import { expect, test } from 'vitest'
import { MOLECULES, moleculeBySmiles, searchMolecules } from './structure_library.ts'
import { isValidSmiles } from './structure_view.ts'

/** 常见分子库（docs/decisions.md 第 22 节）。 */

test('库中每个分子的 SMILES 都能画出，SMILES 不重复', () => {
  for (const molecule of MOLECULES) expect(isValidSmiles(molecule.smiles), molecule.names[0]).toBe(true)
  expect(new Set(MOLECULES.map((molecule) => molecule.smiles)).size).toBe(MOLECULES.length)
})

test('按中文名称（含别名）或英文名称开头查找；完全相同、开头相同的排在前面', () => {
  expect(searchMolecules('苯')[0].names[0]).toBe('苯')
  expect(searchMolecules('苯').map((molecule) => molecule.names[0])).toContain('苯酚')
  expect(searchMolecules('醋酸')[0].english).toBe('acetic acid')
  expect(searchMolecules('Aspirin')[0].names[0]).toBe('阿司匹林')
  expect(searchMolecules('酸').length).toBeLessThanOrEqual(8)
  expect(searchMolecules('  ')).toEqual([])
  expect(searchMolecules('不存在的分子')).toEqual([])
})

test('按 SMILES 找到库中的分子', () => {
  expect(moleculeBySmiles(' CCO ')?.names[0]).toBe('乙醇')
  expect(moleculeBySmiles('OCC')).toBeNull()
})
