/**
 * Word、WPS 复制出的 HTML 不用 <ul> / <ol> 表示列表，而是带 `mso-list:l0 level1 lfo1` 样式的普通段落，
 * 项目符号或编号写在 `mso-list:Ignore` 的 span 中（docs/decisions.md 第 20 节）。
 * 粘贴前把连续的列表段落换成嵌套的 <ul> / <ol>，项目符号与编号去掉，由列表本身表达。
 * 有序列表按第一项的编号保留起始编号与编号样式（data-numbering，docs/decisions.md 第 24 节）。
 */

import { DEFAULT_LIST_NUMBERING, type ListNumbering } from '../../domain/list_numbering/list_numbering.ts'

const LIST_STYLE = /mso-list:\s*l(\d+)\s+level(\d+)/i

/** 编号（1.、1)、(1)、a.、i.、一、、（一）、①）；其余（·、§、o、Ø、▪ 等）是项目符号。 */
const ORDERED_MARKER = /^(?:[(（]?(?:\d+|[a-z]{1,4}|[一二三四五六七八九十百]+)[.)、．）]|[①-⑳])$/i

interface ListParagraph {
  readonly element: HTMLElement
  readonly list: string
  readonly level: number
  readonly ordered: boolean
  readonly start: number | null
  readonly numbering: ListNumbering
}

/** 把 html 中 Word / WPS 的列表段落换成 HTML 列表；没有列表段落时原样返回。 */
export function officeListsToHtml(html: string): string {
  if (!/mso-list/i.test(html)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let changed = false
  for (const run of listRuns(doc)) {
    replaceRun(doc, run)
    changed = true
  }
  return changed ? doc.body.innerHTML : html
}

function listParagraph(element: Element): ListParagraph | null {
  if (element.tagName !== 'P') return null
  const style = LIST_STYLE.exec(element.getAttribute('style') ?? '')
  if (!style) return null
  const markerElement = Array.from(element.querySelectorAll('[style]')).find((child) =>
    /mso-list:\s*ignore/i.test(child.getAttribute('style') ?? ''),
  )
  // 只取标记本身：其中嵌套的 span 是标记后用来对齐的空格。
  const marker = (markerElement?.firstChild?.textContent ?? '').replace(/[\s ]/g, '')
  markerElement?.remove()
  const ordered = ORDERED_MARKER.test(marker)
  const markerInfo = ordered ? markerStyle(marker) : null
  return {
    element: element as HTMLElement,
    list: style[1]!,
    level: Number(style[2]),
    ordered,
    start: markerInfo?.start ?? null,
    numbering: markerInfo?.numbering ?? DEFAULT_LIST_NUMBERING,
  }
}

const CHINESE_DIGITS = '一二三四五六七八九'
const ROMAN_VALUES: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }

/**
 * 编号的样式与数值。字母与罗马数字有歧义（i、v、x 等）：i 与两个字母以上的罗马数字是罗马数字，其余单个字母是字母。
 * 没有对应样式的写法（如 a)、(a)）取最接近的（a.）；认不出数值时为 null。
 */
function markerStyle(marker: string): { numbering: ListNumbering; start: number } | null {
  const circled = marker.codePointAt(0)! - 0x2460 + 1
  if (circled >= 1 && circled <= 20) return { numbering: '①', start: circled }
  const match = /^([(（]?)(\d+|[a-z]+|[一二三四五六七八九十百]+)([.)、．）])$/i.exec(marker)
  if (!match) return null
  const [, open, counter, close] = match
  if (/^\d+$/.test(counter)) {
    const numbering: ListNumbering = open === '（' ? '（1）' : open === '(' ? '(1)' : close === ')' ? '1)' : '1.'
    return { numbering, start: Number(counter) }
  }
  if (/^[一二三四五六七八九十百]+$/.test(counter)) return { numbering: open ? '（一）' : '一、', start: chineseValue(counter) }
  const lower = counter.toLowerCase()
  const upper = counter !== lower
  if (lower === 'i' || (lower.length > 1 && /^[ivxlcdm]+$/.test(lower))) return { numbering: upper ? 'I.' : 'i.', start: romanValue(lower) }
  if (lower.length === 1) return { numbering: upper ? 'A.' : 'a.', start: lower.charCodeAt(0) - 96 }
  return null
}

function chineseValue(text: string): number {
  let total = 0
  let digit = 0
  for (const char of text) {
    if (char === '十') total += (digit || 1) * 10
    else if (char === '百') total += (digit || 1) * 100
    else digit = CHINESE_DIGITS.indexOf(char) + 1
    if (char === '十' || char === '百') digit = 0
  }
  return total + digit
}

function romanValue(text: string): number {
  let total = 0
  for (let i = 0; i < text.length; i++) {
    const value = ROMAN_VALUES[text[i]]
    total += value < (ROMAN_VALUES[text[i + 1]] ?? 0) ? -value : value
  }
  return total
}

/** 相邻的列表段落（中间只隔空白文字或注释）组成一组。 */
function listRuns(doc: Document): ListParagraph[][] {
  const runs: ListParagraph[][] = []
  let current: ListParagraph[] = []
  let previous: Element | null = null
  for (const element of Array.from(doc.body.querySelectorAll('p'))) {
    const item = listParagraph(element)
    if (!item) continue
    if (previous !== null && adjacentSibling(previous) === element) current.push(item)
    else {
      if (current.length > 0) runs.push(current)
      current = [item]
    }
    previous = element
  }
  if (current.length > 0) runs.push(current)
  return runs
}

function adjacentSibling(element: Element): Node | null {
  let next = element.nextSibling
  while (next && (next.nodeType === 8 || (next.nodeType === 3 && !/\S/.test(next.textContent ?? '')))) next = next.nextSibling
  return next
}

interface OpenList {
  readonly level: number
  readonly list: string
  readonly ordered: boolean
  readonly element: HTMLElement
}

function replaceRun(doc: Document, run: readonly ListParagraph[]): void {
  const container = doc.createDocumentFragment()
  const stack: OpenList[] = []
  for (const item of run) {
    while (stack.length > 0 && stack.at(-1)!.level > item.level) stack.pop()
    const top = stack.at(-1)
    if (top && top.level === item.level && (top.ordered !== item.ordered || top.list !== item.list)) stack.pop()
    if (stack.length === 0 || stack.at(-1)!.level < item.level) {
      const list = doc.createElement(item.ordered ? 'ol' : 'ul')
      if (item.start !== null && item.start !== 1) list.setAttribute('start', String(item.start))
      if (item.ordered && item.numbering !== DEFAULT_LIST_NUMBERING) list.setAttribute('data-numbering', item.numbering)
      const parent = stack.at(-1)
      const host = parent ? (parent.element.lastElementChild ?? parent.element.appendChild(doc.createElement('li'))) : container
      host.appendChild(list)
      stack.push({ level: item.level, list: item.list, ordered: item.ordered, element: list })
    }
    const li = doc.createElement('li')
    const paragraph = doc.createElement('p')
    paragraph.append(...Array.from(item.element.childNodes))
    li.appendChild(paragraph)
    stack.at(-1)!.element.appendChild(li)
  }
  run[0]!.element.before(container)
  for (const item of run) item.element.remove()
}
