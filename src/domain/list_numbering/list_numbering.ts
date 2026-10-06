/**
 * 有序列表的编号样式（docs/decisions.md 第 24 节）。
 *
 * 样式以编号写法本身表示：其中的 1 / 一 / ① / I / i / A / a 是计数符号，其余是前后缀
 * （与 Typst 的编号写法相同）。正文中写作有序列表之前的 `<!-- writer:list <样式> -->`；`1.` 是默认样式，不写出。
 * 编号文字与 Rust（Typst 的编号规则）一致，由共享 fixture `src-tauri/fixtures/list_numbering.json` 约束。
 */

export const LIST_NUMBERINGS = ['1.', '1)', '(1)', '（1）', '一、', '（一）', '①', 'I.', 'i.', 'A.', 'a.'] as const

export type ListNumbering = (typeof LIST_NUMBERINGS)[number]

export const DEFAULT_LIST_NUMBERING: ListNumbering = '1.'

export function isListNumbering(value: unknown): value is ListNumbering {
  return typeof value === 'string' && (LIST_NUMBERINGS as readonly string[]).includes(value)
}

/** 第 n 项的编号文字（含前后缀）。计数符号表示不了的数（如 0 的字母、51 以上的圈码）以阿拉伯数字代替。 */
export function formatListMarker(numbering: ListNumbering, n: number): string {
  const counter = /[1一①IiAa]/.exec(numbering)!
  const prefix = numbering.slice(0, counter.index)
  const suffix = numbering.slice(counter.index + 1)
  return `${prefix}${counterText(counter[0], n) ?? String(n)}${suffix}`
}

function counterText(symbol: string, n: number): string | null {
  switch (symbol) {
    case '1':
      return String(n)
    case '一':
      return chinese(n)
    case '①':
      return n <= 50 ? circled(n) : null
    case 'I':
      return roman(n)
    case 'i':
      return roman(n)?.toLowerCase() ?? null
    case 'A':
      return latin(n)
    case 'a':
      return latin(n)?.toLowerCase() ?? null
    default:
      return null
  }
}

/** ⓪ ① … ⑳、㉑ … ㉟、㊱ … ㊿。 */
function circled(n: number): string {
  if (n === 0) return '⓪'
  if (n <= 20) return String.fromCodePoint(0x2460 + n - 1)
  if (n <= 35) return String.fromCodePoint(0x3251 + n - 21)
  return String.fromCodePoint(0x32b1 + n - 36)
}

const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

/** 0 是 N（与 Typst 相同）；3999 以上（Typst 用上划线表示千位）不会出现在列表中，以阿拉伯数字代替。 */
function roman(n: number): string | null {
  if (n === 0) return 'N'
  if (n < 0 || n > 3999) return null
  let rest = n
  let out = ''
  for (const [value, letters] of ROMAN) {
    while (rest >= value) {
      out += letters
      rest -= value
    }
  }
  return out
}

/** 双射的字母计数：A … Z、AA、AB …。 */
function latin(n: number): string | null {
  if (n < 1) return null
  let rest = n
  let out = ''
  while (rest > 0) {
    rest--
    out = String.fromCharCode(65 + (rest % 26)) + out
    rest = Math.floor(rest / 26)
  }
  return out
}

const DIGITS = '零一二三四五六七八九'
const SMALL_UNITS = ['', '十', '百', '千']
const LARGE_UNITS = ['', '万', '亿', '万亿']

/** 小写中文数字（万进）：十、十一、二十、一百零一、一千零一十、一万…… */
function chinese(n: number): string {
  if (n === 0) return DIGITS[0]
  const groups: number[] = []
  for (let rest = n; rest > 0; rest = Math.floor(rest / 10000)) groups.push(rest % 10000)
  let out = ''
  let zero = false
  for (let g = groups.length - 1; g >= 0; g--) {
    const group = groups[g]
    if (group === 0) {
      zero = out !== ''
      continue
    }
    if (out !== '' && (zero || group < 1000)) out += DIGITS[0]
    out += groupText(group) + LARGE_UNITS[g]
    zero = false
  }
  return out.startsWith('一十') ? out.slice(1) : out
}

/** 万以内的一组：中间的连续零读作一个“零”，末尾的零不读。 */
function groupText(group: number): string {
  let out = ''
  let zero = false
  for (let i = 3; i >= 0; i--) {
    const digit = Math.floor(group / 10 ** i) % 10
    if (digit === 0) {
      zero = out !== ''
      continue
    }
    if (zero) out += DIGITS[0]
    out += DIGITS[digit] + SMALL_UNITS[i]
    zero = false
  }
  return out
}
