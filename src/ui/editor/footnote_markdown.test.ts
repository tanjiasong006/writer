import { describe, expect, test } from 'vitest'
import { parseMarkdown, serializeChapter } from './markdown.ts'
import { nodes, schema } from './schema.ts'
import type { Node } from 'prosemirror-model'

function notes(doc: Node): Array<{ text: string; source: string | null }> {
  const out: Array<{ text: string; source: string | null }> = []
  doc.descendants((node) => {
    if (node.type === nodes.footnote) out.push({ text: node.attrs.text, source: node.attrs.source })
    return true
  })
  return out
}

describe('脚注 Markdown', () => {
  test('引用合成脚注节点，定义不是正文中的块；同一定义被引用多次时各是一条', () => {
    const doc = parseMarkdown('正文[^a]，再[^b]与[^a]。\n\n[^a]: 第一条 **粗**\n    续行\n\n[^b]: 第二条\n')
    expect(doc.childCount).toBe(1)
    expect(doc.textContent).toBe('正文，再与。')
    expect(notes(doc)).toEqual([
      { text: '第一条 粗 续行', source: '第一条 **粗**\n    续行' },
      { text: '第二条', source: '第二条' },
      { text: '第一条 粗 续行', source: '第一条 **粗**\n    续行' },
    ])
  })

  test('没有定义的 [^x] 与行内脚注 ^[…] 是文字', () => {
    const doc = parseMarkdown('见[^x]与^[行内]。')
    expect(notes(doc)).toEqual([])
    expect(doc.textContent).toBe('见[^x]与^[行内]。')
  })

  test('写出：按顺序重新编号，定义写在末尾；内容未改时写回原文', () => {
    const doc = parseMarkdown('甲[^z]乙[^a]。\n\n[^a]: 第二 *斜*\n\n[^z]: 第一\n')
    expect(serializeChapter(doc)).toBe('甲[^1]乙[^2]。\n\n[^1]: 第一\n\n[^2]: 第二 *斜*\n')
  })

  test('修改过的内容按文字转义写出；没有内容的脚注不写出', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('甲'),
        nodes.footnote.create({ text: '见 *星号* [^1]', source: '旧的' }),
        schema.text('乙'),
        nodes.footnote.create({ text: '  ' }),
      ]),
    ])
    const written = serializeChapter(doc)
    expect(written).toBe('甲[^1]乙\n\n[^1]: 见 \\*星号\\* \\[^1\\]\n')
    expect(notes(parseMarkdown(written))).toEqual([{ text: '见 *星号* [^1]', source: '见 \\*星号\\* \\[^1\\]' }])
  })

  test('强调紧挨脚注时仍能往返', () => {
    const doc = parseMarkdown('**重要**[^1]的结论。\n\n[^1]: 说明\n')
    const written = serializeChapter(doc)
    expect(parseMarkdown(written).toJSON()).toEqual(doc.toJSON())
  })

  test('表格单元格中的脚注', () => {
    const doc = parseMarkdown('| 甲 |\n| --- |\n| 乙[^1] |\n\n[^1]: 表注\n')
    expect(notes(doc)).toEqual([{ text: '表注', source: '表注' }])
    expect(serializeChapter(doc)).toBe('| 甲 |\n| --- |\n| 乙[^1] |\n\n[^1]: 表注\n')
  })
})
