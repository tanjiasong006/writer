/**
 * 常见分子库（docs/decisions.md 第 22 节）：插入化学结构式时按名称查找。SMILES 使用凯库勒式（单双键交替）的写法，
 * 苯环画成单双键交替的六边形，与中学教材相同；不标注立体构型。
 */

export interface Molecule {
  /** 中文名称；第一个是显示的名称，其余是别名。不在库中的分子（文档中用过的）为空。 */
  readonly names: readonly string[]
  readonly english: string
  readonly smiles: string
  /** 无机小分子写成化学式（如 H2O），不画骨架；数字显示为下标。 */
  readonly formula?: string
}

export const MOLECULES: readonly Molecule[] = [
  // 常见的无机小分子（反应式中的反应物、产物与试剂）
  { names: ['水'], english: 'water', smiles: 'O', formula: 'H2O' },
  { names: ['氢气'], english: 'hydrogen', smiles: '[H][H]', formula: 'H2' },
  { names: ['氧气'], english: 'oxygen', smiles: 'O=O', formula: 'O2' },
  { names: ['氮气'], english: 'nitrogen', smiles: 'N#N', formula: 'N2' },
  { names: ['氯气'], english: 'chlorine', smiles: 'ClCl', formula: 'Cl2' },
  { names: ['溴', '液溴'], english: 'bromine', smiles: 'BrBr', formula: 'Br2' },
  { names: ['氨', '氨气'], english: 'ammonia', smiles: 'N', formula: 'NH3' },
  { names: ['氯化氢', '盐酸'], english: 'hydrogen chloride', smiles: 'Cl', formula: 'HCl' },
  { names: ['溴化氢'], english: 'hydrogen bromide', smiles: 'Br', formula: 'HBr' },
  { names: ['二氧化碳'], english: 'carbon dioxide', smiles: 'O=C=O', formula: 'CO2' },
  { names: ['过氧化氢', '双氧水'], english: 'hydrogen peroxide', smiles: 'OO', formula: 'H2O2' },
  { names: ['硫酸', '浓硫酸'], english: 'sulfuric acid', smiles: 'OS(=O)(=O)O', formula: 'H2SO4' },
  { names: ['硝酸', '浓硝酸'], english: 'nitric acid', smiles: 'O[N+](=O)[O-]', formula: 'HNO3' },
  // 烃
  { names: ['甲烷'], english: 'methane', smiles: 'C' },
  { names: ['乙烷'], english: 'ethane', smiles: 'CC' },
  { names: ['丙烷'], english: 'propane', smiles: 'CCC' },
  { names: ['正丁烷', '丁烷'], english: 'butane', smiles: 'CCCC' },
  { names: ['异丁烷', '2-甲基丙烷'], english: 'isobutane', smiles: 'CC(C)C' },
  { names: ['新戊烷', '2,2-二甲基丙烷'], english: 'neopentane', smiles: 'CC(C)(C)C' },
  { names: ['环戊烷'], english: 'cyclopentane', smiles: 'C1CCCC1' },
  { names: ['环己烷'], english: 'cyclohexane', smiles: 'C1CCCCC1' },
  { names: ['乙烯'], english: 'ethylene', smiles: 'C=C' },
  { names: ['丙烯'], english: 'propylene', smiles: 'CC=C' },
  { names: ['1,3-丁二烯', '丁二烯'], english: '1,3-butadiene', smiles: 'C=CC=C' },
  { names: ['异戊二烯', '2-甲基-1,3-丁二烯'], english: 'isoprene', smiles: 'CC(=C)C=C' },
  { names: ['环己烯'], english: 'cyclohexene', smiles: 'C1=CCCCC1' },
  { names: ['乙炔'], english: 'acetylene', smiles: 'C#C' },
  { names: ['苯'], english: 'benzene', smiles: 'C1=CC=CC=C1' },
  { names: ['甲苯'], english: 'toluene', smiles: 'CC1=CC=CC=C1' },
  { names: ['邻二甲苯'], english: 'o-xylene', smiles: 'CC1=CC=CC=C1C' },
  { names: ['对二甲苯'], english: 'p-xylene', smiles: 'CC1=CC=C(C)C=C1' },
  { names: ['乙苯'], english: 'ethylbenzene', smiles: 'CCC1=CC=CC=C1' },
  { names: ['苯乙烯'], english: 'styrene', smiles: 'C=CC1=CC=CC=C1' },
  { names: ['萘'], english: 'naphthalene', smiles: 'C1=CC=C2C=CC=CC2=C1' },
  { names: ['蒽'], english: 'anthracene', smiles: 'C1=CC=C2C=C3C=CC=CC3=CC2=C1' },
  // 卤代烃
  { names: ['一氯甲烷', '氯甲烷'], english: 'chloromethane', smiles: 'CCl' },
  { names: ['二氯甲烷'], english: 'dichloromethane', smiles: 'ClCCl' },
  { names: ['三氯甲烷', '氯仿'], english: 'chloroform', smiles: 'ClC(Cl)Cl' },
  { names: ['四氯化碳'], english: 'carbon tetrachloride', smiles: 'ClC(Cl)(Cl)Cl' },
  { names: ['溴乙烷'], english: 'bromoethane', smiles: 'CCBr' },
  { names: ['氯乙烯'], english: 'vinyl chloride', smiles: 'C=CCl' },
  { names: ['氯苯'], english: 'chlorobenzene', smiles: 'ClC1=CC=CC=C1' },
  { names: ['溴苯'], english: 'bromobenzene', smiles: 'BrC1=CC=CC=C1' },
  // 醇、酚、醚
  { names: ['甲醇'], english: 'methanol', smiles: 'CO' },
  { names: ['乙醇', '酒精'], english: 'ethanol', smiles: 'CCO' },
  { names: ['1-丙醇', '正丙醇'], english: '1-propanol', smiles: 'CCCO' },
  { names: ['2-丙醇', '异丙醇'], english: 'isopropanol', smiles: 'CC(C)O' },
  { names: ['乙二醇'], english: 'ethylene glycol', smiles: 'OCCO' },
  { names: ['丙三醇', '甘油'], english: 'glycerol', smiles: 'OCC(O)CO' },
  { names: ['苯甲醇'], english: 'benzyl alcohol', smiles: 'OCC1=CC=CC=C1' },
  { names: ['苯酚', '石炭酸'], english: 'phenol', smiles: 'OC1=CC=CC=C1' },
  { names: ['乙醚', '二乙醚'], english: 'diethyl ether', smiles: 'CCOCC' },
  { names: ['环氧乙烷'], english: 'ethylene oxide', smiles: 'C1CO1' },
  // 醛、酮
  { names: ['甲醛'], english: 'formaldehyde', smiles: 'C=O' },
  { names: ['乙醛'], english: 'acetaldehyde', smiles: 'CC=O' },
  { names: ['苯甲醛'], english: 'benzaldehyde', smiles: 'O=CC1=CC=CC=C1' },
  { names: ['丙酮'], english: 'acetone', smiles: 'CC(C)=O' },
  // 羧酸及其衍生物
  { names: ['甲酸', '蚁酸'], english: 'formic acid', smiles: 'OC=O' },
  { names: ['乙酸', '醋酸'], english: 'acetic acid', smiles: 'CC(=O)O' },
  { names: ['丙烯酸'], english: 'acrylic acid', smiles: 'C=CC(=O)O' },
  { names: ['乙二酸', '草酸'], english: 'oxalic acid', smiles: 'OC(=O)C(=O)O' },
  { names: ['己二酸'], english: 'adipic acid', smiles: 'OC(=O)CCCCC(=O)O' },
  { names: ['苯甲酸', '安息香酸'], english: 'benzoic acid', smiles: 'OC(=O)C1=CC=CC=C1' },
  { names: ['邻苯二甲酸'], english: 'phthalic acid', smiles: 'OC(=O)C1=CC=CC=C1C(=O)O' },
  { names: ['对苯二甲酸'], english: 'terephthalic acid', smiles: 'OC(=O)C1=CC=C(C=C1)C(=O)O' },
  { names: ['水杨酸', '邻羟基苯甲酸'], english: 'salicylic acid', smiles: 'OC(=O)C1=CC=CC=C1O' },
  { names: ['乳酸'], english: 'lactic acid', smiles: 'CC(O)C(=O)O' },
  { names: ['柠檬酸'], english: 'citric acid', smiles: 'OC(=O)CC(O)(CC(=O)O)C(=O)O' },
  { names: ['硬脂酸', '十八酸'], english: 'stearic acid', smiles: 'CCCCCCCCCCCCCCCCCC(=O)O' },
  { names: ['乙酸乙酯'], english: 'ethyl acetate', smiles: 'CCOC(C)=O' },
  { names: ['乙酸酐', '醋酸酐'], english: 'acetic anhydride', smiles: 'CC(=O)OC(C)=O' },
  { names: ['乙酰胺'], english: 'acetamide', smiles: 'CC(N)=O' },
  { names: ['尿素', '脲'], english: 'urea', smiles: 'NC(N)=O' },
  // 含氮、含硫
  { names: ['甲胺'], english: 'methylamine', smiles: 'CN' },
  { names: ['乙胺'], english: 'ethylamine', smiles: 'CCN' },
  { names: ['己二胺'], english: 'hexamethylenediamine', smiles: 'NCCCCCCN' },
  { names: ['苯胺'], english: 'aniline', smiles: 'NC1=CC=CC=C1' },
  { names: ['硝基苯'], english: 'nitrobenzene', smiles: '[O-][N+](=O)C1=CC=CC=C1' },
  { names: ['三硝基甲苯', 'TNT', '2,4,6-三硝基甲苯'], english: 'trinitrotoluene', smiles: 'CC1=C(C=C(C=C1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]' },
  { names: ['苯磺酸'], english: 'benzenesulfonic acid', smiles: 'OS(=O)(=O)C1=CC=CC=C1' },
  { names: ['吡啶'], english: 'pyridine', smiles: 'C1=CC=NC=C1' },
  { names: ['吡咯'], english: 'pyrrole', smiles: 'C1=CNC=C1' },
  { names: ['呋喃'], english: 'furan', smiles: 'C1=COC=C1' },
  { names: ['噻吩'], english: 'thiophene', smiles: 'C1=CSC=C1' },
  // 生物分子与药物
  { names: ['甘氨酸', '氨基乙酸'], english: 'glycine', smiles: 'NCC(=O)O' },
  { names: ['丙氨酸'], english: 'alanine', smiles: 'CC(N)C(=O)O' },
  { names: ['葡萄糖（链状）', '葡萄糖'], english: 'glucose (open chain)', smiles: 'OCC(O)C(O)C(O)C(O)C=O' },
  { names: ['葡萄糖（环状）', '吡喃葡萄糖'], english: 'glucose (pyranose)', smiles: 'OCC1OC(O)C(O)C(O)C1O' },
  { names: ['果糖（链状）', '果糖'], english: 'fructose (open chain)', smiles: 'OCC(O)C(O)C(O)C(=O)CO' },
  { names: ['维生素 C', '维生素C', '抗坏血酸'], english: 'ascorbic acid', smiles: 'OCC(O)C1OC(=O)C(O)=C1O' },
  { names: ['阿司匹林', '乙酰水杨酸'], english: 'aspirin', smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O' },
  { names: ['对乙酰氨基酚', '扑热息痛'], english: 'paracetamol', smiles: 'CC(=O)NC1=CC=C(O)C=C1' },
  { names: ['咖啡因'], english: 'caffeine', smiles: 'CN1C=NC2=C1C(=O)N(C)C(=O)N2C' },
]

/** 列出的结果数上限。 */
const MAX_RESULTS = 8

/** 按名称查找：中文名称包含查询的文字，或英文名称以它开头（不区分大小写）；名称以它开头的排在前面。 */
export function searchMolecules(query: string): readonly Molecule[] {
  const text = query.trim().toLowerCase()
  if (text === '') return []
  const scored: Array<{ molecule: Molecule; score: number; index: number }> = []
  MOLECULES.forEach((molecule, index) => {
    const names = molecule.names.map((name) => name.toLowerCase())
    let score = -1
    if (names.some((name) => name === text) || molecule.english === text) score = 0
    else if (names.some((name) => name.startsWith(text)) || molecule.english.startsWith(text)) score = 1
    else if (names.some((name) => name.includes(text))) score = 2
    if (score >= 0) scored.push({ molecule, score, index })
  })
  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map(({ molecule }) => molecule)
}

/** SMILES 恰好是库中某个分子时返回它（编辑已有的结构式时显示名称）。 */
export function moleculeBySmiles(smiles: string): Molecule | null {
  const text = smiles.trim()
  return MOLECULES.find((molecule) => molecule.smiles === text) ?? null
}

/** 名称（中文名称、别名或英文名称，不区分大小写）恰好是库中某个分子时返回它。 */
export function moleculeByName(name: string): Molecule | null {
  const text = name.trim().toLowerCase()
  if (text === '') return null
  return MOLECULES.find((molecule) => molecule.english === text || molecule.names.some((item) => item.toLowerCase() === text)) ?? null
}

/**
 * 反应式的一侧（反应物或产物）在浮层中的写法：分子的名称或 SMILES，以“+”分隔（方括号中的 + 是电荷，不分隔）。
 * 例如“乙醇 + 乙酸”。
 */
export function splitTerms(text: string): string[] {
  const terms: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if ('[［【'.includes(char)) depth++
    else if (']］】'.includes(char)) depth = Math.max(0, depth - 1)
    if ((char === '+' || char === '＋') && depth === 0) {
      terms.push(current)
      current = ''
    } else current += char
  }
  terms.push(current)
  return terms.map((term) => term.trim()).filter((term) => term !== '')
}

/**
 * 文档中用过的分子（按出现顺序，不重复）：结构式本身，反应式中是各个反应物与产物；不含试剂与库中写成化学式的无机小分子。
 * 库中有的是库中的分子，其他没有名称（names 为空）。
 */
export function usedMolecules(structures: readonly string[]): readonly Molecule[] {
  const seen = new Set<string>()
  const result: Molecule[] = []
  for (const structure of structures) {
    const parts = structure.split('>')
    const molecules = parts.length === 3 ? [parts[0], parts[2]].flatMap((side) => side.split('.')) : [structure]
    for (const text of molecules) {
      const smiles = text.trim()
      if (smiles === '' || seen.has(smiles)) continue
      seen.add(smiles)
      const molecule = moleculeBySmiles(smiles)
      if (!molecule?.formula) result.push(molecule ?? { names: [], english: '', smiles })
    }
  }
  return result
}

/** 中文输入法打出的符号：句号、方括号与全角空格。 */
const IME_SYMBOLS: Readonly<Record<string, string>> = { '。': '.', '【': '[', '】': ']', '　': ' ' }

/**
 * 输入的 SMILES：全角字符（（）＝＃［］＠ 等）换成半角，中文输入法的符号换成对应的 SMILES 符号。
 * 只用于当作 SMILES 的文字；按名称查找仍用原文（名称中有全角括号）。
 */
export function smilesText(text: string): string {
  return text
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[。【】　]/g, (char) => IME_SYMBOLS[char])
    .trim()
}

/** 一项的 SMILES：库中的名称换成它的 SMILES，其他当作 SMILES。 */
export function termSmiles(term: string): string {
  return moleculeByName(term)?.smiles ?? smilesText(term)
}

/** 一侧的写法 → SMILES（各分子以 . 相连）。 */
export function sideSmiles(text: string): string {
  return splitTerms(text).map(termSmiles).join('.')
}

/** 一侧的 SMILES → 浮层中的写法：库中有的分子写名称。 */
export function sideText(smiles: string): string {
  return smiles
    .split('.')
    .map((molecule) => molecule.trim())
    .filter((molecule) => molecule !== '')
    .map((molecule) => moleculeBySmiles(molecule)?.names[0] ?? molecule)
    .join(' + ')
}
