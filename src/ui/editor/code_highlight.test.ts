import { afterEach, expect, test } from 'vitest'
import { EditorView } from 'prosemirror-view'
import { codeLanguageLabel, highlightCode } from './code_highlight.ts'
import { parseMarkdown, serializeChapter } from './markdown.ts'
import { createEditorState } from './plugins.ts'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

function viewOf(markdown: string): EditorView {
  const view = new EditorView(document.body.appendChild(document.createElement('div')), {
    state: createEditorState(parseMarkdown(markdown)),
  })
  views.push(view)
  return view
}

function tokenTexts(code: string, params: string): string[] {
  return highlightCode(code, params).map((t) => `${t.scope}:${code.slice(t.from, t.to)}`)
}

test('按围栏声明的语言高亮，转义字符按原文计算位置', () => {
  expect(tokenTexts('const a = "<x>" // c', 'js')).toEqual([
    'hljs-keyword:const',
    'hljs-string:"<x>"',
    'hljs-comment:// c',
  ])
})

test('信息字符串只取第一个词作为语言，大小写不敏感', () => {
  expect(tokenTexts('return 1', 'Python title="a.py"')).toEqual(['hljs-keyword:return', 'hljs-number:1'])
})

test('嵌套记号取最内层，区间互不重叠', () => {
  const code = 'const s = `a ${b} c`'
  const tokens = highlightCode(code, 'js')
  for (let i = 1; i < tokens.length; i++) expect(tokens[i]!.from).toBeGreaterThanOrEqual(tokens[i - 1]!.to)
  expect(tokenTexts(code, 'js')).toContain('hljs-subst:${b}')
})

test('没有声明语言时自动识别；识别不可靠时不着色', () => {
  expect(tokenTexts("SELECT id FROM t WHERE name = 'x';", '')).toContain("hljs-string:'x'")
  expect(highlightCode('样本 A → 样本 B → 汇总', '')).toEqual([])
  expect(highlightCode('第一步：打开文件\n第二步：保存', '')).toEqual([])
  expect(highlightCode('   \n', 'js')).toEqual([])
})

test('不认识的语言名按没有声明处理', () => {
  expect(highlightCode('这是一段普通文字', 'no-such-language')).toEqual([])
})

test('编辑器中代码块显示高亮，文档与 Markdown 不变', () => {
  const markdown = '```js\nconst a = 1\n```\n'
  const view = viewOf(markdown)
  const keyword = view.dom.querySelector('pre .code-keyword')
  expect(keyword?.textContent).toBe('const')
  expect(view.dom.querySelector('pre .code-number')?.textContent).toBe('1')
  expect(serializeChapter(view.state.doc)).toBe(markdown)
})

test('编辑代码块后重新高亮', () => {
  const view = viewOf('```js\nconst a = 1\n```\n')
  view.dispatch(view.state.tr.insertText('// note\n', 1))
  expect(view.dom.querySelector('pre .code-comment')?.textContent).toBe('// note')
})

test('角标：声明的语言显示名称，别名与大小写视为相同；不认识的原样显示；没有语言时没有角标', () => {
  expect(codeLanguageLabel('py')).toBe('Python')
  expect(codeLanguageLabel('TS title="a.ts"')).toBe('TypeScript')
  expect(codeLanguageLabel('xml')).toBe('HTML / XML')
  expect(codeLanguageLabel('mermaid')).toBe('mermaid')
  expect(codeLanguageLabel('')).toBeNull()
})

test('编辑器中声明了语言的代码块带角标，自动识别的没有', () => {
  const view = viewOf('```python\nx = 1\n```\n\n```\nSELECT 1;\n```\n')
  const [declared, auto] = view.dom.querySelectorAll('pre')
  expect(declared!.dataset.language).toBe('Python')
  expect(auto!.hasAttribute('data-language')).toBe(false)
})

test('纯文本不着色', () => {
  expect(highlightCode("SELECT id FROM t WHERE name = 'x';", 'text')).toEqual([])
})
