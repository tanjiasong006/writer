import { describe, expect, test } from 'vitest'
import type { EditorState } from 'prosemirror-state'
import { parseMarkdown, serializeChapter } from './markdown.ts'
import { createEditorState } from './plugins.ts'
import { findMatches, nextMatchIndex, previousMatchIndex, replaceMatches, selectedMatchIndex } from './find.ts'
import { undo } from './commands.ts'

function texts(markdown: string, query: string): string[] {
  const doc = parseMarkdown(markdown)
  return findMatches(doc, query).map(({ from, to }) => doc.textBetween(from, to))
}

describe('findMatches', () => {
  test('找到每个文字块中的全部匹配，按文档顺序，互不重叠', () => {
    expect(texts('甲乙甲\n\n- 甲\n\n```\n甲甲甲\n```', '甲')).toEqual(['甲', '甲', '甲', '甲', '甲', '甲'])
    expect(texts('aaaa', 'aa')).toHaveLength(2)
  })

  test('拉丁字母不区分大小写', () => {
    expect(texts('Writer writer WRITER', 'writer')).toEqual(['Writer', 'writer', 'WRITER'])
  })

  test('跨过格式边界匹配，不跨段落', () => {
    expect(texts('研究**方法**很好', '究方法很')).toEqual(['究方法很'])
    expect(texts('研究\n\n方法', '研究方法')).toEqual([])
  })

  test('章节引用与换行不与文字一起匹配', () => {
    expect(texts('见[2 方法](writer:chapter/a)一节', '方法')).toEqual([])
    expect(texts('甲  \n乙', '甲乙')).toEqual([])
  })

  test('空查找词没有匹配', () => {
    expect(texts('甲', '')).toEqual([])
  })
})

describe('上一个 / 下一个', () => {
  const matches = [
    { from: 1, to: 3 },
    { from: 5, to: 7 },
    { from: 9, to: 11 },
  ]

  test('选区是匹配时，下一个是它之后的匹配', () => {
    expect(nextMatchIndex(matches, { from: 5, to: 7 })).toBe(2)
    expect(previousMatchIndex(matches, { from: 5, to: 7 })).toBe(0)
    expect(selectedMatchIndex(matches, { from: 5, to: 7 })).toBe(1)
  })

  test('光标在匹配之间', () => {
    expect(nextMatchIndex(matches, { from: 4, to: 4 })).toBe(1)
    expect(previousMatchIndex(matches, { from: 4, to: 4 })).toBe(0)
    expect(nextMatchIndex(matches, { from: 12, to: 12 })).toBe(-1)
    expect(previousMatchIndex(matches, { from: 0, to: 0 })).toBe(-1)
  })
})

describe('replaceMatches', () => {
  function state(markdown: string): EditorState {
    return createEditorState(parseMarkdown(markdown))
  }

  test('一次事务替换全部匹配，保留格式，可以撤销', () => {
    const before = state('甲**乙甲**甲')
    const after = before.apply(replaceMatches(before, findMatches(before.doc, '甲'), '丙丙'))
    expect(serializeChapter(after.doc)).toBe('丙丙**乙丙丙**丙丙\n')
    let restored = after
    undo(after, (tr) => (restored = after.apply(tr)))
    expect(serializeChapter(restored.doc)).toBe('甲**乙甲**甲\n')
  })

  test('替换为空即删除', () => {
    const before = state('甲乙甲')
    const after = before.apply(replaceMatches(before, findMatches(before.doc, '甲'), ''))
    expect(after.doc.textContent).toBe('乙')
  })

  test('只替换给出的匹配', () => {
    const before = state('甲乙甲')
    const [first] = findMatches(before.doc, '甲')
    const after = before.apply(replaceMatches(before, [first], '丙'))
    expect(after.doc.textContent).toBe('丙乙甲')
  })
})
