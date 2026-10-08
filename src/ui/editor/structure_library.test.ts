import { expect, test } from 'vitest'
import { MOLECULES, moleculeBySmiles, searchMolecules, sideSmiles, smilesText, usedMolecules } from './structure_library.ts'
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

test('输入的 SMILES：全角字符与中文输入法的符号换成半角；按名称查找仍用原文', () => {
  expect(smilesText(' CC（＝Ｏ）Ｏ ')).toBe('CC(=O)O')
  expect(smilesText('C＃C。【NH4+】')).toBe('C#C.[NH4+]')
  expect(searchMolecules('葡萄糖（链状）')[0].english).toBe('glucose (open chain)')
  // 全角方括号中的 + 仍是电荷，不分隔分子。
  expect(sideSmiles('乙醇 ＋ 【NH4＋】')).toBe('CCO.[NH4+]')
})

test('文档中用过的分子：结构式与反应式的反应物、产物，按出现顺序不重复；不含试剂与写成化学式的无机小分子', () => {
  const molecules = usedMolecules(['C1CCNCC1', 'CCO.CC(=O)O>OS(=O)(=O)O>CCOC(C)=O.O', ' C1CCNCC1 ', 'CCO'])
  expect(molecules.map((molecule) => molecule.names[0] ?? molecule.smiles)).toEqual(['C1CCNCC1', '乙醇', '乙酸', '乙酸乙酯'])
  expect(molecules[0].names).toEqual([])
})
