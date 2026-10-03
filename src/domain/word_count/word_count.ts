/**
 * 字数统计（纯函数，规则参照 Word 的“字数”）：
 *
 * - 汉字、日文假名、韩文字母与全角 / 中文标点每个计 1；
 * - 其余文字按词计：连续的字母与数字（可含词内的 ' ’ -）计 1；
 * - 空白与半角标点不计。
 *
 * 字符数是不含空白的字符（按 Unicode 码位）数量。
 */
export interface TextCount {
  /** 字数。 */
  readonly words: number
  /** 字符数（不含空白）。 */
  readonly characters: number
}

export const NO_TEXT: TextCount = { words: 0, characters: 0 }

/** 逐字计数的字符：东亚文字与全角 / 中文标点。 */
const EAST_ASIAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}、-〿！-｠￠-￮‘’“”—…·]/gu
/** 按词计数的文字：东亚文字以外的字母与数字，词内可以有 ' ’ -。 */
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

export function countText(text: string): TextCount {
  const eastAsian = text.match(EAST_ASIAN)?.length ?? 0
  const words = text.replace(EAST_ASIAN, ' ').match(WORD)?.length ?? 0
  let characters = 0
  for (const char of text) if (!/\s/u.test(char)) characters += 1
  return { words: eastAsian + words, characters }
}

export function addCounts(a: TextCount, b: TextCount): TextCount {
  return { words: a.words + b.words, characters: a.characters + b.characters }
}
