import hljs from 'highlight.js/lib/common'
import type { Node } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { nodes } from './schema.ts'

/**
 * 代码块语法高亮：只是展示（decoration），不进入文档、不影响 Markdown 与 Word / PDF 输出。
 *
 * 代码块的语言来自 Markdown 围栏的信息字符串（```ts）。用工具栏或 ⌘0 插入的代码块没有语言，
 * 这时自动识别；识别不可靠（内容太短、像普通文字）时不着色，宁可不高亮也不乱高亮。
 */

export interface CodeToken {
  readonly from: number
  readonly to: number
  /** highlight.js 的记号类别（keyword、string、comment…），多个类别以空格分隔。 */
  readonly scope: string
}

/** 自动识别的最低可信度（highlight.js relevance）；低于它的识别结果基本是猜测。 */
const MIN_AUTO_RELEVANCE = 2
/** 自动识别只看开头这么多字符，避免长代码块每次输入都用所有语言各解析一遍。 */
const AUTO_DETECT_SAMPLE = 1000
/**
 * 不参与自动识别的语言：CSS 类语言把任意单词当作选择器、ini 把 “x = 1” 当作配置，普通文字也会被它们着色；
 * vbnet 与 SQL 难以区分，却把单引号当作注释开始。
 * 围栏声明了这些语言时照常高亮。
 */
const AUTO_DETECT_LANGUAGES = hljs
  .listLanguages()
  .filter((name) => !['css', 'less', 'scss', 'ini', 'vbnet', 'markdown', 'plaintext'].includes(name))

/** 信息字符串的第一个词是语言名（```ts title="a.ts" → ts）；highlight.js 不认识时返回 null。 */
function declaredLanguage(params: string): string | null {
  const name = params.trim().split(/\s+/, 1)[0]?.toLowerCase()
  return name && hljs.getLanguage(name) ? name : null
}

function detectLanguage(code: string): string | null {
  const result = hljs.highlightAuto(code.slice(0, AUTO_DETECT_SAMPLE), AUTO_DETECT_LANGUAGES)
  return result.language && result.relevance >= MIN_AUTO_RELEVANCE ? result.language : null
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'" }

/**
 * highlight.js 输出的 HTML → 记号区间（相对代码文字的偏移）。嵌套的记号取最内层，区间互不重叠。
 * 输出只包含 <span class="hljs-…">、</span> 与转义过的文字。
 */
function tokensFromHtml(html: string): CodeToken[] {
  const tokens: CodeToken[] = []
  const scopes: string[] = []
  let offset = 0
  let start = 0
  const flush = () => {
    const scope = scopes.at(-1)
    if (scope && offset > start) tokens.push({ from: start, to: offset, scope })
    start = offset
  }
  for (const [part, open, entity] of html.matchAll(/<span class="([^"]*)">|<\/span>|&([#\w]+);|[^<&]+/g)) {
    if (open !== undefined || part === '</span>') {
      flush()
      if (open !== undefined) scopes.push(open)
      else scopes.pop()
    } else {
      offset += entity !== undefined ? (ENTITIES[entity] ?? part).length : part.length
    }
  }
  flush()
  return tokens
}

/** 代码的记号区间；无法确定语言时为空。 */
export function highlightCode(code: string, params: string): readonly CodeToken[] {
  if (!/\S/.test(code)) return []
  const language = declaredLanguage(params) ?? detectLanguage(code)
  if (!language) return []
  return tokensFromHtml(hljs.highlight(code, { language, ignoreIllegals: true }).value)
}

/** 未变的代码块节点在编辑前后是同一个对象，按节点缓存，只重新解析被修改的代码块。 */
const tokenCache = new WeakMap<Node, readonly CodeToken[]>()

function tokensOf(node: Node): readonly CodeToken[] {
  let tokens = tokenCache.get(node)
  if (!tokens) {
    tokens = highlightCode(node.textContent, node.attrs.params as string)
    tokenCache.set(node, tokens)
  }
  return tokens
}

/** 记号的类名（hljs-title function_ → code-title code-function_），样式见 document_body.css。 */
function tokenClass(token: CodeToken): string {
  return token.scope
    .split(' ')
    .map((name) => `code-${name.replace(/^hljs-/, '')}`)
    .join(' ')
}

/** 只读展示的代码块（全文阅读）：结构与编辑器中的代码块相同，高亮与编辑器一致。 */
export function highlightedCodeDOM(node: Node): HTMLElement {
  const pre = document.createElement('pre')
  if (node.attrs.params) pre.dataset.params = node.attrs.params as string
  const code = pre.appendChild(document.createElement('code'))
  const text = node.textContent
  let offset = 0
  for (const token of tokensOf(node)) {
    if (token.from > offset) code.append(text.slice(offset, token.from))
    const span = code.appendChild(document.createElement('span'))
    span.className = tokenClass(token)
    span.textContent = text.slice(token.from, token.to)
    offset = token.to
  }
  if (offset < text.length) code.append(text.slice(offset))
  return pre
}

function highlightDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type !== nodes.code_block) return !node.isTextblock
    for (const token of tokensOf(node)) {
      decorations.push(Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: tokenClass(token) }))
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

export function codeHighlight(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    state: {
      init: (_, state) => highlightDecorations(state.doc),
      apply: (tr, set) => (tr.docChanged ? highlightDecorations(tr.doc) : set),
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
    },
  })
}
