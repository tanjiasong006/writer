/**
 * 常见分子库（docs/decisions.md 第 22 节）：插入化学结构式时按名称查找。SMILES 使用凯库勒式（单双键交替）的写法，
 * 苯环画成单双键交替的六边形，与中学教材相同；不标注立体构型。
 */

export interface Molecule {
  /** 中文名称；第一个是显示的名称，其余是别名。 */
  readonly names: readonly string[]
  readonly english: string
  readonly smiles: string
}

export const MOLECULES: readonly Molecule[] = [
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
