/**
 * 化学式（docs/decisions.md 第 22 节）：内容整个是 `\ce{…}`（mhchem 写法）的公式。保存格式与普通公式相同，
 * 只是编辑时在化学式浮层中直接写 mhchem 的内容（如 `2H2 + O2 -> 2H2O`）。
 */

/** 整个公式是一个 `\ce{…}` 时返回其中的内容，否则为 null。 */
export function chemContent(tex: string): string | null {
  const match = /^\s*\\ce\s*\{/.exec(tex)
  if (!match) return null
  const start = match[0].length
  let depth = 1
  for (let i = start; i < tex.length; i++) {
    const c = tex[i]
    if (c === '\\') i++
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return tex.slice(i + 1).trim() === '' ? tex.slice(start, i) : null
  }
  return null
}

/** 化学式的内容 → 公式；内容为空时是空公式（完成即删除）。 */
export function chemTex(content: string): string {
  const trimmed = content.trim()
  return trimmed === '' ? '' : `\\ce{${trimmed}}`
}
