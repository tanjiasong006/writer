/**
 * 元素周期表：化学式浮层中点击插入元素符号（docs/decisions.md 第 22 节）。
 * 镧系与锕系单独排在下方两行（与教材相同），主表中第 3 族的第 6、7 周期留空。
 */

export interface Element {
  readonly number: number
  readonly symbol: string
  readonly name: string
  /** 在周期表中的行（1–7 是周期，9、10 是镧系与锕系，第 8 行留空）与列（族，1–18）。 */
  readonly row: number
  readonly column: number
}

const SYMBOLS =
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu ' +
  'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr ' +
  'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'

const NAMES =
  '氢氦锂铍硼碳氮氧氟氖钠镁铝硅磷硫氯氩钾钙钪钛钒铬锰铁钴镍铜锌镓锗砷硒溴氪' +
  '铷锶钇锆铌钼锝钌铑钯银镉铟锡锑碲碘氙铯钡镧铈镨钕钷钐铕钆铽镝钬铒铥镱镥' +
  '铪钽钨铼锇铱铂金汞铊铅铋钋砹氡钫镭锕钍镤铀镎钚镅锔锫锎锿镄钔锘铹' +
  '𬬻𬭊𬭳𬭛𬭶鿏𫟼𬬭鿔鿭𫓧镆𫟷鿬鿫'

/** 各周期第一个元素的序数。 */
const PERIOD_STARTS = [1, 3, 11, 19, 37, 55, 87, 119]

function position(number: number): { row: number; column: number } {
  const period = PERIOD_STARTS.findIndex((start) => number < start)
  const offset = number - PERIOD_STARTS[period - 1]
  const length = PERIOD_STARTS[period] - PERIOD_STARTS[period - 1]
  if (period === 1) return { row: 1, column: offset === 0 ? 1 : 18 }
  if (offset < 2) return { row: period, column: offset + 1 }
  if (length === 32) {
    // 第 6、7 周期：第 3 个起的 15 个是镧系 / 锕系。
    if (offset < 17) return { row: period + 3, column: offset + 1 }
    return { row: period, column: offset - 13 }
  }
  return { row: period, column: offset + 19 - length }
}

export const ELEMENTS: readonly Element[] = SYMBOLS.split(' ').map((symbol, index) => ({
  number: index + 1,
  symbol,
  name: [...NAMES][index],
  ...position(index + 1),
}))
