import { describe, expect, test } from 'vitest'
import type { Node } from 'prosemirror-model'
import { parseMarkdown, serializeChapter } from './markdown.ts'
import { nodes, schema } from './schema.ts'

function inlineMath(doc: Node): Array<[string, boolean]> {
  const out: Array<[string, boolean]> = []
  doc.descendants((node) => {
    if (node.type === nodes.math) out.push([node.attrs.tex, node.attrs.display])
    return true
  })
  return out
}

describe('公式 Markdown（与 pulldown-cmark 的规则相同）', () => {
  test('行内 $…$ 与段落中的 $$…$$', () => {
    const doc = parseMarkdown('面积 $\\pi r^2$ 与 $$E=mc^2$$。')
    expect(inlineMath(doc)).toEqual([['\\pi r^2', false], ['E=mc^2', true]])
    expect(doc.textContent).toBe('面积 \\pi r^2 与 E=mc^2。')
  })

  test('只含行间公式的段落是公式块，内容去掉首尾空白', () => {
    const doc = parseMarkdown('$$\n\\int_0^1 x\\,dx\n$$')
    expect(doc.firstChild!.type).toBe(nodes.math_block)
    expect(doc.firstChild!.attrs.tex).toBe('\\int_0^1 x\\,dx')
  })

  test('不是公式：开头 $ 后是空白、结尾 $ 前是空白、花括号不平衡、转义的 $', () => {
    for (const text of ['价格 $5 与 $ 6$', '$ x$', '$x $', '$}x$', '\\$x\\$', '$x']) {
      expect(inlineMath(parseMarkdown(text)), text).toEqual([])
    }
    // 花括号中的 $ 不结束公式；公式中转义的 $ 保留。
    expect(inlineMath(parseMarkdown('$\\text{a$b} + 1$'))).toEqual([['\\text{a$b} + 1', false]])
    expect(inlineMath(parseMarkdown('$a \\$ b$'))).toEqual([['a \\$ b', false]])
  })

  test('写出：行内公式、公式块；文字中的 $ 转义', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('价格 $5，'),
        nodes.math.create({ tex: 'x^2' }),
        schema.text('。'),
      ]),
      nodes.math_block.create({ tex: 'a\n\nb' }),
    ])
    const written = serializeChapter(doc)
    expect(written).toBe('价格 \\$5，$x^2$。\n\n$$\na\nb\n$$\n')
    const reparsed = parseMarkdown(written)
    expect(inlineMath(reparsed)).toEqual([['x^2', false]])
    expect(reparsed.lastChild!.attrs.tex).toBe('a\nb')
    expect(reparsed.firstChild!.textContent).toBe('价格 $5，x^2。')
  })

  test('公式与强调相邻时仍能往返', () => {
    const doc = parseMarkdown('**设** $x>0$**时**成立。')
    expect(parseMarkdown(serializeChapter(doc)).toJSON()).toEqual(doc.toJSON())
  })
})
