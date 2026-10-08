/**
 * 分子库（docs/decisions.md 第 22 节）：插入化学结构式时按名称查找。分两层：
 *
 * - 核心库（MOLECULES）：人工整理的常见分子。SMILES 使用凯库勒式（单双键交替）的写法，苯环画成单双键交替的六边形，
 *   与中学教材相同；不标注立体构型。
 * - 扩展库（molecules_extended.json，由 scripts/molecules 从 Wikidata 生成）：约一万两千个有中文名称的化合物，
 *   凯库勒式，保留立体构型。第一次打开结构式浮层时加载（loadExtendedMolecules），查找时排在核心库之后。
 *
 * 画结构式只用核心库（写成化学式的无机小分子、反应式中试剂的名称），画出的结果不随扩展库是否已加载而变化。
 */

export interface Molecule {
  /** 中文名称；第一个是显示的名称，其余是别名。不在库中的分子（文档中用过的）为空。 */
  readonly names: readonly string[]
  readonly english: string
  readonly smiles: string
  /** 无机小分子写成化学式（如 H2O），不画骨架；数字显示为下标。 */
  readonly formula?: string
  /** 扩展库中的分子。 */
  readonly extended?: boolean
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
  { names: ['一氧化碳'], english: 'carbon monoxide', smiles: '[C-]#[O+]', formula: 'CO' },
  { names: ['二氧化硫'], english: 'sulfur dioxide', smiles: 'O=S=O', formula: 'SO2' },
  { names: ['三氧化硫'], english: 'sulfur trioxide', smiles: 'O=S(=O)=O', formula: 'SO3' },
  { names: ['一氧化氮'], english: 'nitric oxide', smiles: '[N]=O', formula: 'NO' },
  { names: ['二氧化氮'], english: 'nitrogen dioxide', smiles: '[O]N=O', formula: 'NO2' },
  { names: ['四氧化二氮'], english: 'dinitrogen tetroxide', smiles: 'O=[N+]([O-])[N+](=O)[O-]', formula: 'N2O4' },
  { names: ['臭氧'], english: 'ozone', smiles: 'O=[O+][O-]', formula: 'O3' },
  { names: ['硫化氢'], english: 'hydrogen sulfide', smiles: 'S', formula: 'H2S' },
  { names: ['氟化氢', '氢氟酸'], english: 'hydrogen fluoride', smiles: 'F', formula: 'HF' },
  { names: ['碘化氢', '氢碘酸'], english: 'hydrogen iodide', smiles: 'I', formula: 'HI' },
  { names: ['氟气'], english: 'fluorine', smiles: 'FF', formula: 'F2' },
  { names: ['碘', '碘单质'], english: 'iodine', smiles: 'II', formula: 'I2' },
  { names: ['次氯酸'], english: 'hypochlorous acid', smiles: 'OCl', formula: 'HClO' },
  { names: ['亚硫酸'], english: 'sulfurous acid', smiles: 'O=S(O)O', formula: 'H2SO3' },
  { names: ['碳酸'], english: 'carbonic acid', smiles: 'O=C(O)O', formula: 'H2CO3' },
  { names: ['磷酸'], english: 'phosphoric acid', smiles: 'O=P(O)(O)O', formula: 'H3PO4' },
  { names: ['氢氰酸', '氰化氢'], english: 'hydrogen cyanide', smiles: 'C#N', formula: 'HCN' },
  { names: ['二硫化碳'], english: 'carbon disulfide', smiles: 'S=C=S', formula: 'CS2' },
  { names: ['肼', '联氨'], english: 'hydrazine', smiles: 'NN', formula: 'N2H4' },
  { names: ['氯化亚砜', '亚硫酰氯'], english: 'thionyl chloride', smiles: 'O=S(Cl)Cl', formula: 'SOCl2' },
  { names: ['三氯化磷'], english: 'phosphorus trichloride', smiles: 'ClP(Cl)Cl', formula: 'PCl3' },
  { names: ['三氯氧磷', '三氯化磷酰'], english: 'phosphoryl chloride', smiles: 'O=P(Cl)(Cl)Cl', formula: 'POCl3' },
  { names: ['三氟化硼'], english: 'boron trifluoride', smiles: 'FB(F)F', formula: 'BF3' },
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
  { names: ['正戊烷', '戊烷'], english: 'pentane', smiles: 'CCCCC' },
  { names: ['异戊烷', '2-甲基丁烷'], english: 'isopentane', smiles: 'CCC(C)C' },
  { names: ['正己烷', '己烷'], english: 'hexane', smiles: 'CCCCCC' },
  { names: ['正庚烷', '庚烷'], english: 'heptane', smiles: 'CCCCCCC' },
  { names: ['正辛烷', '辛烷'], english: 'octane', smiles: 'CCCCCCCC' },
  { names: ['异辛烷', '2,2,4-三甲基戊烷'], english: '2,2,4-trimethylpentane', smiles: 'CC(C)CC(C)(C)C' },
  { names: ['环丙烷'], english: 'cyclopropane', smiles: 'C1CC1' },
  { names: ['环丁烷'], english: 'cyclobutane', smiles: 'C1CCC1' },
  { names: ['甲基环己烷'], english: 'methylcyclohexane', smiles: 'CC1CCCCC1' },
  { names: ['1-丁烯'], english: '1-butene', smiles: 'C=CCC' },
  { names: ['2-丁烯'], english: '2-butene', smiles: 'CC=CC' },
  { names: ['异丁烯', '2-甲基丙烯'], english: 'isobutylene', smiles: 'C=C(C)C' },
  { names: ['1-戊烯'], english: '1-pentene', smiles: 'C=CCCC' },
  { names: ['环戊二烯'], english: 'cyclopentadiene', smiles: 'C1=CCC=C1' },
  { names: ['1,3-环己二烯'], english: '1,3-cyclohexadiene', smiles: 'C1=CCCC=C1' },
  { names: ['氯丁二烯', '2-氯-1,3-丁二烯'], english: 'chloroprene', smiles: 'C=CC(=C)Cl' },
  { names: ['四氟乙烯'], english: 'tetrafluoroethylene', smiles: 'FC(F)=C(F)F' },
  { names: ['丙烯腈'], english: 'acrylonitrile', smiles: 'C=CC#N' },
  { names: ['甲基丙烯酸甲酯'], english: 'methyl methacrylate', smiles: 'C=C(C)C(=O)OC' },
  { names: ['乙酸乙烯酯'], english: 'vinyl acetate', smiles: 'C=COC(C)=O' },
  { names: ['丙炔'], english: 'propyne', smiles: 'C#CC' },
  { names: ['1-丁炔'], english: '1-butyne', smiles: 'C#CCC' },
  { names: ['2-丁炔'], english: '2-butyne', smiles: 'CC#CC' },
  { names: ['苯乙炔'], english: 'phenylacetylene', smiles: 'C#CC1=CC=CC=C1' },
  { names: ['间二甲苯'], english: 'm-xylene', smiles: 'CC1=CC=CC(C)=C1' },
  { names: ['异丙苯'], english: 'cumene', smiles: 'CC(C)C1=CC=CC=C1' },
  { names: ['1,3,5-三甲苯', '均三甲苯'], english: 'mesitylene', smiles: 'CC1=CC(C)=CC(C)=C1' },
  { names: ['联苯'], english: 'biphenyl', smiles: 'C1=CC=C(C2=CC=CC=C2)C=C1' },
  { names: ['二苯甲烷'], english: 'diphenylmethane', smiles: 'C1=CC=C(CC2=CC=CC=C2)C=C1' },
  { names: ['三苯甲烷'], english: 'triphenylmethane', smiles: 'C1=CC=C(C(C2=CC=CC=C2)C2=CC=CC=C2)C=C1' },
  { names: ['菲'], english: 'phenanthrene', smiles: 'C1=CC=C2C(=C1)C=CC1=CC=CC=C12' },
  { names: ['茚'], english: 'indene', smiles: 'C1=CC=C2CC=CC2=C1' },
  // 卤代烃
  { names: ['一氯甲烷', '氯甲烷'], english: 'chloromethane', smiles: 'CCl' },
  { names: ['二氯甲烷'], english: 'dichloromethane', smiles: 'ClCCl' },
  { names: ['三氯甲烷', '氯仿'], english: 'chloroform', smiles: 'ClC(Cl)Cl' },
  { names: ['四氯化碳'], english: 'carbon tetrachloride', smiles: 'ClC(Cl)(Cl)Cl' },
  { names: ['溴乙烷'], english: 'bromoethane', smiles: 'CCBr' },
  { names: ['氯乙烯'], english: 'vinyl chloride', smiles: 'C=CCl' },
  { names: ['氯苯'], english: 'chlorobenzene', smiles: 'ClC1=CC=CC=C1' },
  { names: ['溴苯'], english: 'bromobenzene', smiles: 'BrC1=CC=CC=C1' },
  { names: ['溴甲烷'], english: 'bromomethane', smiles: 'CBr' },
  { names: ['碘甲烷'], english: 'iodomethane', smiles: 'CI' },
  { names: ['氯乙烷'], english: 'chloroethane', smiles: 'CCCl' },
  { names: ['碘乙烷'], english: 'iodoethane', smiles: 'CCI' },
  { names: ['1-氯丙烷'], english: '1-chloropropane', smiles: 'CCCCl' },
  { names: ['2-氯丙烷'], english: '2-chloropropane', smiles: 'CC(C)Cl' },
  { names: ['1-溴丙烷'], english: '1-bromopropane', smiles: 'CCCBr' },
  { names: ['2-溴丙烷'], english: '2-bromopropane', smiles: 'CC(C)Br' },
  { names: ['1-溴丁烷'], english: '1-bromobutane', smiles: 'CCCCBr' },
  { names: ['2-溴丁烷'], english: '2-bromobutane', smiles: 'CCC(C)Br' },
  { names: ['2-氯-2-甲基丙烷', '叔丁基氯'], english: 'tert-butyl chloride', smiles: 'CC(C)(C)Cl' },
  { names: ['2-溴-2-甲基丙烷', '叔丁基溴'], english: 'tert-butyl bromide', smiles: 'CC(C)(C)Br' },
  { names: ['1,2-二氯乙烷'], english: '1,2-dichloroethane', smiles: 'ClCCCl' },
  { names: ['1,2-二溴乙烷'], english: '1,2-dibromoethane', smiles: 'BrCCBr' },
  { names: ['3-氯丙烯', '烯丙基氯'], english: 'allyl chloride', smiles: 'C=CCCl' },
  { names: ['二氯二氟甲烷', '氟利昂-12'], english: 'dichlorodifluoromethane', smiles: 'FC(F)(Cl)Cl' },
  { names: ['三氯乙烯'], english: 'trichloroethylene', smiles: 'ClC=C(Cl)Cl' },
  { names: ['四氯乙烯'], english: 'tetrachloroethylene', smiles: 'ClC(Cl)=C(Cl)Cl' },
  { names: ['碘苯'], english: 'iodobenzene', smiles: 'IC1=CC=CC=C1' },
  { names: ['氟苯'], english: 'fluorobenzene', smiles: 'FC1=CC=CC=C1' },
  { names: ['对二氯苯'], english: '1,4-dichlorobenzene', smiles: 'ClC1=CC=C(Cl)C=C1' },
  { names: ['苄氯', '氯化苄'], english: 'benzyl chloride', smiles: 'ClCC1=CC=CC=C1' },
  { names: ['苄溴', '溴化苄'], english: 'benzyl bromide', smiles: 'BrCC1=CC=CC=C1' },
  { names: ['光气', '碳酰氯'], english: 'phosgene', smiles: 'O=C(Cl)Cl' },
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
  { names: ['1-丁醇', '正丁醇'], english: '1-butanol', smiles: 'CCCCO' },
  { names: ['2-丁醇'], english: '2-butanol', smiles: 'CCC(C)O' },
  { names: ['2-甲基-1-丙醇', '异丁醇'], english: 'isobutanol', smiles: 'CC(C)CO' },
  { names: ['2-甲基-2-丙醇', '叔丁醇'], english: 'tert-butanol', smiles: 'CC(C)(C)O' },
  { names: ['1-戊醇', '正戊醇'], english: '1-pentanol', smiles: 'CCCCCO' },
  { names: ['3-甲基-1-丁醇', '异戊醇'], english: 'isoamyl alcohol', smiles: 'CC(C)CCO' },
  { names: ['环己醇'], english: 'cyclohexanol', smiles: 'OC1CCCCC1' },
  { names: ['烯丙醇', '2-丙烯-1-醇'], english: 'allyl alcohol', smiles: 'C=CCO' },
  { names: ['1,2-丙二醇'], english: 'propylene glycol', smiles: 'CC(O)CO' },
  { names: ['1,3-丙二醇'], english: '1,3-propanediol', smiles: 'OCCCO' },
  { names: ['1,4-丁二醇'], english: '1,4-butanediol', smiles: 'OCCCCO' },
  { names: ['2-苯乙醇', '苯乙醇'], english: '2-phenylethanol', smiles: 'OCCC1=CC=CC=C1' },
  { names: ['1-苯乙醇'], english: '1-phenylethanol', smiles: 'CC(O)C1=CC=CC=C1' },
  { names: ['乙醇胺', '2-氨基乙醇'], english: 'ethanolamine', smiles: 'NCCO' },
  { names: ['季戊四醇'], english: 'pentaerythritol', smiles: 'OCC(CO)(CO)CO' },
  { names: ['山梨醇'], english: 'sorbitol', smiles: 'OCC(O)C(O)C(O)C(O)CO' },
  { names: ['邻甲酚', '邻甲基苯酚'], english: 'o-cresol', smiles: 'CC1=CC=CC=C1O' },
  { names: ['间甲酚', '间甲基苯酚'], english: 'm-cresol', smiles: 'CC1=CC(O)=CC=C1' },
  { names: ['对甲酚', '对甲基苯酚'], english: 'p-cresol', smiles: 'CC1=CC=C(O)C=C1' },
  { names: ['邻苯二酚'], english: 'catechol', smiles: 'OC1=CC=CC=C1O' },
  { names: ['间苯二酚'], english: 'resorcinol', smiles: 'OC1=CC=CC(O)=C1' },
  { names: ['对苯二酚'], english: 'hydroquinone', smiles: 'OC1=CC=C(O)C=C1' },
  { names: ['1,2,3-苯三酚', '连苯三酚'], english: 'pyrogallol', smiles: 'OC1=CC=CC(O)=C1O' },
  { names: ['2,4,6-三溴苯酚'], english: '2,4,6-tribromophenol', smiles: 'OC1=C(Br)C=C(Br)C=C1Br' },
  { names: ['2,4,6-三硝基苯酚', '苦味酸'], english: 'picric acid', smiles: 'O=[N+]([O-])C1=CC([N+](=O)[O-])=C(O)C([N+](=O)[O-])=C1' },
  { names: ['对硝基苯酚'], english: '4-nitrophenol', smiles: 'O=[N+]([O-])C1=CC=C(O)C=C1' },
  { names: ['1-萘酚', 'α-萘酚'], english: '1-naphthol', smiles: 'OC1=CC=CC2=CC=CC=C12' },
  { names: ['2-萘酚', 'β-萘酚'], english: '2-naphthol', smiles: 'OC1=CC2=CC=CC=C2C=C1' },
  { names: ['双酚 A', '双酚A'], english: 'bisphenol A', smiles: 'CC(C)(C1=CC=C(O)C=C1)C1=CC=C(O)C=C1' },
  { names: ['二甲醚', '甲醚'], english: 'dimethyl ether', smiles: 'COC' },
  { names: ['甲乙醚'], english: 'ethyl methyl ether', smiles: 'CCOC' },
  { names: ['甲基叔丁基醚'], english: 'methyl tert-butyl ether', smiles: 'COC(C)(C)C' },
  { names: ['苯甲醚', '茴香醚'], english: 'anisole', smiles: 'COC1=CC=CC=C1' },
  { names: ['二苯醚'], english: 'diphenyl ether', smiles: 'C1=CC=C(OC2=CC=CC=C2)C=C1' },
  { names: ['环氧丙烷'], english: 'propylene oxide', smiles: 'CC1CO1' },
  { names: ['四氢呋喃'], english: 'tetrahydrofuran', smiles: 'C1CCOC1' },
  { names: ['1,4-二氧六环', '二噁烷'], english: '1,4-dioxane', smiles: 'C1COCCO1' },
  { names: ['18-冠-6'], english: '18-crown-6', smiles: 'C1COCCOCCOCCOCCOCCO1' },
  // 醛、酮
  { names: ['甲醛'], english: 'formaldehyde', smiles: 'C=O' },
  { names: ['乙醛'], english: 'acetaldehyde', smiles: 'CC=O' },
  { names: ['苯甲醛'], english: 'benzaldehyde', smiles: 'O=CC1=CC=CC=C1' },
  { names: ['丙酮'], english: 'acetone', smiles: 'CC(C)=O' },
  { names: ['丙醛'], english: 'propanal', smiles: 'CCC=O' },
  { names: ['丁醛'], english: 'butanal', smiles: 'CCCC=O' },
  { names: ['丙烯醛'], english: 'acrolein', smiles: 'C=CC=O' },
  { names: ['2-丁烯醛', '巴豆醛'], english: 'crotonaldehyde', smiles: 'CC=CC=O' },
  { names: ['乙二醛'], english: 'glyoxal', smiles: 'O=CC=O' },
  { names: ['苯乙醛'], english: 'phenylacetaldehyde', smiles: 'O=CCC1=CC=CC=C1' },
  { names: ['肉桂醛', '3-苯基丙烯醛'], english: 'cinnamaldehyde', smiles: 'O=CC=CC1=CC=CC=C1' },
  { names: ['糠醛', '2-呋喃甲醛'], english: 'furfural', smiles: 'O=CC1=CC=CO1' },
  { names: ['香草醛', '香兰素'], english: 'vanillin', smiles: 'COC1=C(O)C=CC(C=O)=C1' },
  { names: ['水杨醛', '邻羟基苯甲醛'], english: 'salicylaldehyde', smiles: 'O=CC1=CC=CC=C1O' },
  { names: ['三氯乙醛'], english: 'chloral', smiles: 'O=CC(Cl)(Cl)Cl' },
  { names: ['丁酮', '2-丁酮'], english: 'butanone', smiles: 'CCC(C)=O' },
  { names: ['2-戊酮'], english: '2-pentanone', smiles: 'CCCC(C)=O' },
  { names: ['3-戊酮'], english: '3-pentanone', smiles: 'CCC(=O)CC' },
  { names: ['环戊酮'], english: 'cyclopentanone', smiles: 'O=C1CCCC1' },
  { names: ['环己酮'], english: 'cyclohexanone', smiles: 'O=C1CCCCC1' },
  { names: ['苯乙酮'], english: 'acetophenone', smiles: 'CC(=O)C1=CC=CC=C1' },
  { names: ['二苯甲酮'], english: 'benzophenone', smiles: 'O=C(C1=CC=CC=C1)C1=CC=CC=C1' },
  { names: ['2,4-戊二酮', '乙酰丙酮'], english: 'acetylacetone', smiles: 'CC(=O)CC(C)=O' },
  { names: ['对苯醌'], english: '1,4-benzoquinone', smiles: 'O=C1C=CC(=O)C=C1' },
  { names: ['乙烯酮'], english: 'ketene', smiles: 'C=C=O' },
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
  { names: ['丙酸'], english: 'propionic acid', smiles: 'CCC(=O)O' },
  { names: ['丁酸', '正丁酸'], english: 'butyric acid', smiles: 'CCCC(=O)O' },
  { names: ['2-甲基丙酸', '异丁酸'], english: 'isobutyric acid', smiles: 'CC(C)C(=O)O' },
  { names: ['戊酸'], english: 'valeric acid', smiles: 'CCCCC(=O)O' },
  { names: ['十六酸', '软脂酸', '棕榈酸'], english: 'palmitic acid', smiles: 'CCCCCCCCCCCCCCCC(=O)O' },
  { names: ['甲基丙烯酸'], english: 'methacrylic acid', smiles: 'C=C(C)C(=O)O' },
  { names: ['2-丁烯酸', '巴豆酸'], english: 'crotonic acid', smiles: 'CC=CC(=O)O' },
  { names: ['丙二酸'], english: 'malonic acid', smiles: 'O=C(O)CC(=O)O' },
  { names: ['丁二酸', '琥珀酸'], english: 'succinic acid', smiles: 'O=C(O)CCC(=O)O' },
  { names: ['戊二酸'], english: 'glutaric acid', smiles: 'O=C(O)CCCC(=O)O' },
  { names: ['间苯二甲酸'], english: 'isophthalic acid', smiles: 'O=C(O)C1=CC=CC(C(=O)O)=C1' },
  { names: ['苯乙酸'], english: 'phenylacetic acid', smiles: 'O=C(O)CC1=CC=CC=C1' },
  { names: ['肉桂酸', '3-苯基丙烯酸'], english: 'cinnamic acid', smiles: 'O=C(O)C=CC1=CC=CC=C1' },
  { names: ['一氯乙酸', '氯乙酸'], english: 'chloroacetic acid', smiles: 'O=C(O)CCl' },
  { names: ['二氯乙酸'], english: 'dichloroacetic acid', smiles: 'O=C(O)C(Cl)Cl' },
  { names: ['三氯乙酸'], english: 'trichloroacetic acid', smiles: 'O=C(O)C(Cl)(Cl)Cl' },
  { names: ['三氟乙酸'], english: 'trifluoroacetic acid', smiles: 'O=C(O)C(F)(F)F' },
  { names: ['羟基乙酸', '乙醇酸'], english: 'glycolic acid', smiles: 'O=C(O)CO' },
  { names: ['苹果酸', '2-羟基丁二酸'], english: 'malic acid', smiles: 'O=C(O)CC(O)C(=O)O' },
  { names: ['酒石酸', '2,3-二羟基丁二酸'], english: 'tartaric acid', smiles: 'O=C(O)C(O)C(O)C(=O)O' },
  { names: ['丙酮酸'], english: 'pyruvic acid', smiles: 'CC(=O)C(=O)O' },
  { names: ['乙酰乙酸'], english: 'acetoacetic acid', smiles: 'CC(=O)CC(=O)O' },
  { names: ['没食子酸', '3,4,5-三羟基苯甲酸'], english: 'gallic acid', smiles: 'O=C(O)C1=CC(O)=C(O)C(O)=C1' },
  { names: ['对羟基苯甲酸'], english: '4-hydroxybenzoic acid', smiles: 'O=C(O)C1=CC=C(O)C=C1' },
  { names: ['对氨基苯甲酸'], english: '4-aminobenzoic acid', smiles: 'NC1=CC=C(C(=O)O)C=C1' },
  { names: ['甲酸甲酯'], english: 'methyl formate', smiles: 'COC=O' },
  { names: ['甲酸乙酯'], english: 'ethyl formate', smiles: 'CCOC=O' },
  { names: ['乙酸甲酯'], english: 'methyl acetate', smiles: 'COC(C)=O' },
  { names: ['乙酸丙酯'], english: 'propyl acetate', smiles: 'CCCOC(C)=O' },
  { names: ['乙酸丁酯'], english: 'butyl acetate', smiles: 'CCCCOC(C)=O' },
  { names: ['乙酸异戊酯'], english: 'isoamyl acetate', smiles: 'CC(=O)OCCC(C)C' },
  { names: ['丙酸乙酯'], english: 'ethyl propionate', smiles: 'CCOC(=O)CC' },
  { names: ['丁酸乙酯'], english: 'ethyl butyrate', smiles: 'CCCC(=O)OCC' },
  { names: ['丙烯酸甲酯'], english: 'methyl acrylate', smiles: 'C=CC(=O)OC' },
  { names: ['苯甲酸甲酯'], english: 'methyl benzoate', smiles: 'COC(=O)C1=CC=CC=C1' },
  { names: ['苯甲酸乙酯'], english: 'ethyl benzoate', smiles: 'CCOC(=O)C1=CC=CC=C1' },
  { names: ['乙酸苯酯'], english: 'phenyl acetate', smiles: 'CC(=O)OC1=CC=CC=C1' },
  { names: ['乙酸苄酯'], english: 'benzyl acetate', smiles: 'CC(=O)OCC1=CC=CC=C1' },
  { names: ['水杨酸甲酯', '冬青油'], english: 'methyl salicylate', smiles: 'COC(=O)C1=CC=CC=C1O' },
  { names: ['乙二酸二乙酯', '草酸二乙酯'], english: 'diethyl oxalate', smiles: 'CCOC(=O)C(=O)OCC' },
  { names: ['乙酰乙酸乙酯'], english: 'ethyl acetoacetate', smiles: 'CCOC(=O)CC(C)=O' },
  { names: ['碳酸二甲酯'], english: 'dimethyl carbonate', smiles: 'COC(=O)OC' },
  { names: ['邻苯二甲酸二丁酯'], english: 'dibutyl phthalate', smiles: 'CCCCOC(=O)C1=CC=CC=C1C(=O)OCCCC' },
  { names: ['对苯二甲酸二甲酯'], english: 'dimethyl terephthalate', smiles: 'COC(=O)C1=CC=C(C(=O)OC)C=C1' },
  { names: ['γ-丁内酯'], english: 'gamma-butyrolactone', smiles: 'O=C1CCCO1' },
  { names: ['硬脂酸甘油酯', '三硬脂酸甘油酯'], english: 'tristearin', smiles: 'CCCCCCCCCCCCCCCCCC(=O)OCC(COC(=O)CCCCCCCCCCCCCCCCC)OC(=O)CCCCCCCCCCCCCCCCC' },
  { names: ['软脂酸甘油酯', '三软脂酸甘油酯'], english: 'tripalmitin', smiles: 'CCCCCCCCCCCCCCCC(=O)OCC(COC(=O)CCCCCCCCCCCCCCC)OC(=O)CCCCCCCCCCCCCCC' },
  { names: ['硝酸甘油', '三硝酸甘油酯'], english: 'nitroglycerin', smiles: 'O=[N+]([O-])OCC(CO[N+](=O)[O-])O[N+](=O)[O-]' },
  { names: ['乙酰氯'], english: 'acetyl chloride', smiles: 'CC(=O)Cl' },
  { names: ['苯甲酰氯'], english: 'benzoyl chloride', smiles: 'O=C(Cl)C1=CC=CC=C1' },
  { names: ['顺丁烯二酸酐', '马来酸酐'], english: 'maleic anhydride', smiles: 'O=C1C=CC(=O)O1' },
  { names: ['邻苯二甲酸酐'], english: 'phthalic anhydride', smiles: 'O=C1OC(=O)C2=CC=CC=C12' },
  { names: ['丁二酸酐', '琥珀酸酐'], english: 'succinic anhydride', smiles: 'O=C1CCC(=O)O1' },
  { names: ['甲酰胺'], english: 'formamide', smiles: 'NC=O' },
  { names: ['N,N-二甲基甲酰胺', 'DMF'], english: 'dimethylformamide', smiles: 'CN(C)C=O' },
  { names: ['N,N-二甲基乙酰胺'], english: 'dimethylacetamide', smiles: 'CC(=O)N(C)C' },
  { names: ['丙烯酰胺'], english: 'acrylamide', smiles: 'C=CC(N)=O' },
  { names: ['苯甲酰胺'], english: 'benzamide', smiles: 'NC(=O)C1=CC=CC=C1' },
  { names: ['乙酰苯胺'], english: 'acetanilide', smiles: 'CC(=O)NC1=CC=CC=C1' },
  { names: ['己内酰胺'], english: 'caprolactam', smiles: 'O=C1CCCCCN1' },
  { names: ['丁二酰亚胺'], english: 'succinimide', smiles: 'O=C1CCC(=O)N1' },
  { names: ['N-溴代丁二酰亚胺', 'NBS'], english: 'N-bromosuccinimide', smiles: 'O=C1CCC(=O)N1Br' },
  { names: ['邻苯二甲酰亚胺'], english: 'phthalimide', smiles: 'O=C1NC(=O)C2=CC=CC=C12' },
  { names: ['乙腈'], english: 'acetonitrile', smiles: 'CC#N' },
  { names: ['苯甲腈'], english: 'benzonitrile', smiles: 'N#CC1=CC=CC=C1' },
  { names: ['丙二腈'], english: 'malononitrile', smiles: 'N#CCC#N' },
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
  { names: ['二甲胺'], english: 'dimethylamine', smiles: 'CNC' },
  { names: ['三甲胺'], english: 'trimethylamine', smiles: 'CN(C)C' },
  { names: ['二乙胺'], english: 'diethylamine', smiles: 'CCNCC' },
  { names: ['三乙胺'], english: 'triethylamine', smiles: 'CCN(CC)CC' },
  { names: ['乙二胺'], english: 'ethylenediamine', smiles: 'NCCN' },
  { names: ['苄胺'], english: 'benzylamine', smiles: 'NCC1=CC=CC=C1' },
  { names: ['N-甲基苯胺'], english: 'N-methylaniline', smiles: 'CNC1=CC=CC=C1' },
  { names: ['N,N-二甲基苯胺'], english: 'N,N-dimethylaniline', smiles: 'CN(C)C1=CC=CC=C1' },
  { names: ['对甲苯胺'], english: 'p-toluidine', smiles: 'CC1=CC=C(N)C=C1' },
  { names: ['对硝基苯胺'], english: '4-nitroaniline', smiles: 'NC1=CC=C([N+](=O)[O-])C=C1' },
  { names: ['对苯二胺'], english: 'p-phenylenediamine', smiles: 'NC1=CC=C(N)C=C1' },
  { names: ['二苯胺'], english: 'diphenylamine', smiles: 'C1=CC=C(NC2=CC=CC=C2)C=C1' },
  { names: ['对氨基苯磺酸'], english: 'sulfanilic acid', smiles: 'NC1=CC=C(S(=O)(=O)O)C=C1' },
  { names: ['苯肼'], english: 'phenylhydrazine', smiles: 'NNC1=CC=CC=C1' },
  { names: ['偶氮苯'], english: 'azobenzene', smiles: 'C1=CC=C(N=NC2=CC=CC=C2)C=C1' },
  { names: ['硝基甲烷'], english: 'nitromethane', smiles: 'C[N+](=O)[O-]' },
  { names: ['间二硝基苯'], english: '1,3-dinitrobenzene', smiles: 'O=[N+]([O-])C1=CC=CC([N+](=O)[O-])=C1' },
  { names: ['对硝基甲苯'], english: '4-nitrotoluene', smiles: 'CC1=CC=C([N+](=O)[O-])C=C1' },
  { names: ['三聚氰胺'], english: 'melamine', smiles: 'NC1=NC(N)=NC(N)=N1' },
  { names: ['乌洛托品', '六亚甲基四胺'], english: 'methenamine', smiles: 'C1N2CN3CN1CN(C2)C3' },
  { names: ['重氮甲烷'], english: 'diazomethane', smiles: 'C=[N+]=[N-]' },
  { names: ['酚酞'], english: 'phenolphthalein', smiles: 'O=C1OC(C2=CC=C(O)C=C2)(C2=CC=C(O)C=C2)C2=CC=CC=C12' },
  { names: ['甲硫醇'], english: 'methanethiol', smiles: 'CS' },
  { names: ['乙硫醇'], english: 'ethanethiol', smiles: 'CCS' },
  { names: ['二甲硫醚'], english: 'dimethyl sulfide', smiles: 'CSC' },
  { names: ['二甲基亚砜', 'DMSO'], english: 'dimethyl sulfoxide', smiles: 'CS(C)=O' },
  { names: ['环丁砜'], english: 'sulfolane', smiles: 'O=S1(=O)CCCC1' },
  { names: ['对甲苯磺酸'], english: 'p-toluenesulfonic acid', smiles: 'CC1=CC=C(S(=O)(=O)O)C=C1' },
  { names: ['对甲苯磺酰氯'], english: 'p-toluenesulfonyl chloride', smiles: 'CC1=CC=C(S(=O)(=O)Cl)C=C1' },
  { names: ['苯磺酰氯'], english: 'benzenesulfonyl chloride', smiles: 'O=S(=O)(Cl)C1=CC=CC=C1' },
  { names: ['甲磺酸'], english: 'methanesulfonic acid', smiles: 'CS(=O)(=O)O' },
  { names: ['十二烷基苯磺酸'], english: '4-dodecylbenzenesulfonic acid', smiles: 'CCCCCCCCCCCCC1=CC=C(S(=O)(=O)O)C=C1' },
  { names: ['硫脲'], english: 'thiourea', smiles: 'NC(N)=S' },
  { names: ['哌啶'], english: 'piperidine', smiles: 'C1CCNCC1' },
  { names: ['吡咯烷', '四氢吡咯'], english: 'pyrrolidine', smiles: 'C1CCNC1' },
  { names: ['吗啉'], english: 'morpholine', smiles: 'C1COCCN1' },
  { names: ['哌嗪'], english: 'piperazine', smiles: 'C1CNCCN1' },
  { names: ['咪唑'], english: 'imidazole', smiles: 'C1=CNC=N1' },
  { names: ['吡唑'], english: 'pyrazole', smiles: 'C1=CNN=C1' },
  { names: ['噻唑'], english: 'thiazole', smiles: 'C1=CSC=N1' },
  { names: ['嘧啶'], english: 'pyrimidine', smiles: 'C1=CN=CN=C1' },
  { names: ['吡嗪'], english: 'pyrazine', smiles: 'C1=CN=CC=N1' },
  { names: ['吲哚'], english: 'indole', smiles: 'C1=CC=C2NC=CC2=C1' },
  { names: ['喹啉'], english: 'quinoline', smiles: 'C1=CC=C2N=CC=CC2=C1' },
  { names: ['异喹啉'], english: 'isoquinoline', smiles: 'C1=CC=C2C=NC=CC2=C1' },
  { names: ['嘌呤'], english: 'purine', smiles: 'C1=NC=C2NC=NC2=N1' },
  { names: ['四氢吡喃'], english: 'tetrahydropyran', smiles: 'C1CCOCC1' },
  { names: ['吡喃'], english: '2H-pyran', smiles: 'C1=CCOC=C1' },
  { names: ['苯并呋喃'], english: 'benzofuran', smiles: 'C1=CC=C2OC=CC2=C1' },
  { names: ['烟酸', '吡啶-3-甲酸'], english: 'nicotinic acid', smiles: 'O=C(O)C1=CC=CN=C1' },
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
  { names: ['缬氨酸'], english: 'valine', smiles: 'CC(C)C(N)C(=O)O' },
  { names: ['亮氨酸'], english: 'leucine', smiles: 'CC(C)CC(N)C(=O)O' },
  { names: ['异亮氨酸'], english: 'isoleucine', smiles: 'CCC(C)C(N)C(=O)O' },
  { names: ['脯氨酸'], english: 'proline', smiles: 'O=C(O)C1CCCN1' },
  { names: ['苯丙氨酸'], english: 'phenylalanine', smiles: 'NC(CC1=CC=CC=C1)C(=O)O' },
  { names: ['色氨酸'], english: 'tryptophan', smiles: 'NC(CC1=CNC2=CC=CC=C12)C(=O)O' },
  { names: ['甲硫氨酸', '蛋氨酸'], english: 'methionine', smiles: 'CSCCC(N)C(=O)O' },
  { names: ['丝氨酸'], english: 'serine', smiles: 'NC(CO)C(=O)O' },
  { names: ['苏氨酸'], english: 'threonine', smiles: 'CC(O)C(N)C(=O)O' },
  { names: ['半胱氨酸'], english: 'cysteine', smiles: 'NC(CS)C(=O)O' },
  { names: ['胱氨酸'], english: 'cystine', smiles: 'NC(CSSCC(N)C(=O)O)C(=O)O' },
  { names: ['酪氨酸'], english: 'tyrosine', smiles: 'NC(CC1=CC=C(O)C=C1)C(=O)O' },
  { names: ['天冬酰胺'], english: 'asparagine', smiles: 'NC(=O)CC(N)C(=O)O' },
  { names: ['谷氨酰胺'], english: 'glutamine', smiles: 'NC(=O)CCC(N)C(=O)O' },
  { names: ['天冬氨酸', '天门冬氨酸'], english: 'aspartic acid', smiles: 'NC(CC(=O)O)C(=O)O' },
  { names: ['谷氨酸'], english: 'glutamic acid', smiles: 'NC(CCC(=O)O)C(=O)O' },
  { names: ['赖氨酸'], english: 'lysine', smiles: 'NCCCCC(N)C(=O)O' },
  { names: ['β-丙氨酸'], english: 'beta-alanine', smiles: 'NCCC(=O)O' },
  { names: ['腺嘌呤'], english: 'adenine', smiles: 'NC1=C2NC=NC2=NC=N1' },
  { names: ['胞嘧啶'], english: 'cytosine', smiles: 'NC1=CC=NC(=O)N1' },
  { names: ['胸腺嘧啶'], english: 'thymine', smiles: 'CC1=CNC(=O)NC1=O' },
  { names: ['尿嘧啶'], english: 'uracil', smiles: 'O=C1C=CNC(=O)N1' },
  { names: ['甘油醛'], english: 'glyceraldehyde', smiles: 'O=CC(O)CO' },
  { names: ['二羟基丙酮'], english: 'dihydroxyacetone', smiles: 'O=C(CO)CO' },
  { names: ['胆碱'], english: 'choline', smiles: 'C[N+](C)(C)CCO' },
  { names: ['乙酰胆碱'], english: 'acetylcholine', smiles: 'CC(=O)OCC[N+](C)(C)C' },
  { names: ['布洛芬'], english: 'ibuprofen', smiles: 'CC(C)CC1=CC=C(C(C)C(=O)O)C=C1' },
  { names: ['萘普生'], english: 'naproxen', smiles: 'COC1=CC2=CC=C(C(C)C(=O)O)C=C2C=C1' },
  { names: ['磺胺'], english: 'sulfanilamide', smiles: 'NC1=CC=C(S(N)(=O)=O)C=C1' },
  { names: ['苯佐卡因'], english: 'benzocaine', smiles: 'CCOC(=O)C1=CC=C(N)C=C1' },
  { names: ['普鲁卡因'], english: 'procaine', smiles: 'CCN(CC)CCOC(=O)C1=CC=C(N)C=C1' },
  { names: ['糖精'], english: 'saccharin', smiles: 'O=C1NS(=O)(=O)C2=CC=CC=C12' },
  { names: ['对羟基苯甲酸甲酯', '尼泊金甲酯'], english: 'methylparaben', smiles: 'COC(=O)C1=CC=C(O)C=C1' },
  { names: ['滴滴涕', 'DDT'], english: 'DDT', smiles: 'ClC1=CC=C(C(C2=CC=C(Cl)C=C2)C(Cl)(Cl)Cl)C=C1' },
  { names: ['六氯苯'], english: 'hexachlorobenzene', smiles: 'ClC1=C(Cl)C(Cl)=C(Cl)C(Cl)=C1Cl' },
]

/** 扩展库的文件：每个分子是 [中文名称, 英文名称, SMILES, 各名称的拼音首字母]；core 是核心库各名称的拼音首字母。 */
interface ExtendedData {
  readonly core: Readonly<Record<string, string>>
  readonly molecules: readonly (readonly [readonly string[], string, string, readonly string[]])[]
}

/** 查找用的写法：全角换成半角，不区分大小写，忽略空白与名称中的连接符号（“2,4,6-三硝基甲苯”与“246三硝基甲苯”相同）。 */
function searchKey(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\-‐‑–—,，、·'′]/g, '')
}

interface Entry {
  readonly molecule: Molecule
  /** 中文名称与英文名称的查找写法。 */
  readonly names: readonly string[]
  readonly english: string
  /** 中文名称的拼音首字母。 */
  readonly initials: readonly string[]
}

function entry(molecule: Molecule, initials: readonly string[]): Entry {
  return { molecule, names: molecule.names.map(searchKey), english: searchKey(molecule.english), initials }
}

let entries: readonly Entry[] = MOLECULES.map((molecule) => entry(molecule, []))
let extended: readonly Molecule[] = []
let loading: Promise<void> | null = null

/** 加载扩展库（只加载一次）；之后查找包含扩展库，核心库也可以按拼音首字母查找。 */
export function loadExtendedMolecules(): Promise<void> {
  // 作为文字导入再解析：不让 TypeScript 推断整个文件的类型；文件由脚本生成，结构由测试检查。
  loading ??= import('./molecules_extended.json?raw').then(({ default: text }) => {
    const data = JSON.parse(text) as ExtendedData
    extended = data.molecules.map(([names, english, smiles]) => ({ names, english, smiles, extended: true }))
    entries = [
      ...MOLECULES.map((molecule) => entry(molecule, molecule.names.map((name) => data.core[name] ?? ''))),
      ...extended.map((molecule, index) => entry(molecule, data.molecules[index][3])),
    ]
  })
  return loading
}

/** 列出的结果数上限。 */
const MAX_RESULTS = 8

/**
 * 按名称查找：中文名称包含查询的文字，英文名称或中文名称的拼音首字母以它开头；完全相同的排在最前，其次是开头相同的。
 * 同样匹配时核心库在前，扩展库按知名程度。
 */
export function searchMolecules(query: string): readonly Molecule[] {
  const text = searchKey(query)
  if (text === '') return []
  const scored: Array<{ molecule: Molecule; score: number; index: number }> = []
  entries.forEach(({ molecule, names, english, initials }, index) => {
    let score = -1
    if (names.includes(text) || english === text) score = 0
    else if (names.some((name) => name.startsWith(text)) || english.startsWith(text) || initials.includes(text)) score = 1
    else if (names.some((name) => name.includes(text)) || initials.some((item) => item.startsWith(text))) score = 2
    if (score >= 0) scored.push({ molecule, score, index })
  })
  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map(({ molecule }) => molecule)
}

/**
 * SMILES 恰好是库中某个分子时返回它（编辑已有的结构式时显示名称）。默认只查核心库（画结构式时用）；
 * withExtended 时也查已加载的扩展库（浮层中显示名称时用）。
 */
export function moleculeBySmiles(smiles: string, withExtended = false): Molecule | null {
  const text = smiles.trim()
  const found = (molecule: Molecule) => molecule.smiles === text
  return MOLECULES.find(found) ?? (withExtended ? extended.find(found) : undefined) ?? null
}

/** 名称（中文名称、别名或英文名称，不区分大小写）恰好是库中（含已加载的扩展库）某个分子时返回它，核心库优先。 */
export function moleculeByName(name: string): Molecule | null {
  const text = name.trim().toLowerCase()
  if (text === '') return null
  const found = (molecule: Molecule) => molecule.english.toLowerCase() === text || molecule.names.some((item) => item.toLowerCase() === text)
  return MOLECULES.find(found) ?? extended.find(found) ?? null
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
      const molecule = moleculeBySmiles(smiles, true)
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

/** 一侧的 SMILES → 浮层中的写法：库中有的分子写名称（名称换回的是同一个分子时；扩展库中有同名的不同分子）。 */
export function sideText(smiles: string): string {
  return smiles
    .split('.')
    .map((molecule) => molecule.trim())
    .filter((molecule) => molecule !== '')
    .map((molecule) => {
      const name = moleculeBySmiles(molecule, true)?.names[0]
      return name !== undefined && moleculeByName(name)?.smiles === molecule ? name : molecule
    })
    .join(' + ')
}
