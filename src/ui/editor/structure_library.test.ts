import { expect, test } from 'vitest'
import { loadExtendedMolecules, MOLECULES, moleculeByName, moleculeBySmiles, searchMolecules, sideSmiles, sideText, smilesText, usedMolecules } from './structure_library.ts'
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

/** 扩展库（scripts/molecules 由 Wikidata 生成）。 */

async function extendedData() {
  const { default: text } = await import('./molecules_extended.json?raw')
  return JSON.parse(text) as { core: Record<string, string>; molecules: [string[], string, string, string[]][] }
}

test('扩展库：每个分子的 SMILES 都能画出且不重复，不与核心库重复；名称与拼音首字母一一对应', async () => {
  const data = await extendedData()
  expect(data.molecules.length).toBeGreaterThan(10000)
  const smiles = new Set(MOLECULES.map((molecule) => molecule.smiles))
  for (const [names, , text, initials] of data.molecules) {
    expect(isValidSmiles(text), text).toBe(true)
    expect(smiles.has(text), text).toBe(false)
    smiles.add(text)
    expect(names.length).toBeGreaterThan(0)
    expect(initials.length).toBe(names.length)
  }
  for (const molecule of MOLECULES) for (const name of molecule.names) expect(data.core, name).toHaveProperty([name])
})

test('加载扩展库后：查找包含扩展库（排在核心库之后），可以用拼音首字母；画结构式仍只用核心库', async () => {
  expect(searchMolecules('红霉素')).toEqual([])
  await loadExtendedMolecules()
  const erythromycin = searchMolecules('红霉素')[0]
  expect(erythromycin.extended).toBe(true)
  expect(erythromycin.smiles).toContain('@')
  expect(searchMolecules('苯')[0].names[0]).toBe('苯')
  expect(searchMolecules('乙酸').slice(0, 2).every((molecule) => !molecule.extended)).toBe(true)
  expect(searchMolecules('yxa')[0].names[0]).toBe('乙酰胺')
  expect(searchMolecules('blf')[0].names[0]).toBe('布洛芬')
  expect(searchMolecules('246三硝基甲苯')[0].english).toBe('trinitrotoluene')
  expect(searchMolecules('ｃａｆｆｅｉｎｅ')[0].names[0]).toBe('咖啡因')
  expect(moleculeByName('布洛芬')?.extended).toBe(true)
  expect(moleculeBySmiles(erythromycin.smiles)).toBeNull()
  expect(moleculeBySmiles(erythromycin.smiles, true)).toBe(erythromycin)
  expect(usedMolecules([erythromycin.smiles])[0].names[0]).toBe('红霉素')
})

test('加载扩展库后：反应式一侧写名称，扩展库中同名的不同分子写 SMILES', async () => {
  await loadExtendedMolecules()
  const ibuprofen = moleculeByName('布洛芬')!.smiles
  expect(sideText(`${ibuprofen}.CCO`)).toBe('布洛芬 + 乙醇')
  expect(sideSmiles('布洛芬 + 乙醇')).toBe(`${ibuprofen}.CCO`)
  const data = await extendedData()
  const counts = new Map<string, number>()
  for (const [names] of data.molecules) for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  const shadowed = data.molecules.find(([names, , text]) => (counts.get(names[0]) ?? 0) > 1 && moleculeByName(names[0])?.smiles !== text)!
  expect(sideText(shadowed[2])).toBe(shadowed[2])
})
