import { expect, test } from 'vitest'
import { parseMarkdown } from './markdown.ts'
import { chapterLabels, elementsOf, indexElements } from './element_numbering.ts'

const docs: Record<string, string> = {
  a: '![甲](a.png "fig:f1")\n\n![](无图注.png)\n\nTable: 表一 {#tbl:t1}\n\n| x |\n| - |',
  a1: '> ![乙](b.png)\n\n- ![丙](c.png "fig:f3")',
  b: '![丁](d.png "fig:f4")\n\nTable: 表二\n\n| y |\n| - |',
}

test('按一级章节分组、按阅读顺序编号；没有图注 / 标题的不编号（与 Rust render::elements 相同）', () => {
  const index = indexElements(
    [
      { id: 'a', top: 1 },
      { id: 'a1', top: 1 },
      { id: 'b', top: 2 },
    ],
    (id) => elementsOf(parseMarkdown(docs[id])),
  )
  expect(index.find('figure', 'f1')?.label).toBe('图 1-1')
  expect(index.find('figure', 'f3')?.label).toBe('图 1-3')
  expect(index.find('figure', 'f4')?.label).toBe('图 2-1')
  expect(index.find('table', 't1')?.label).toBe('表 1-1')
  expect(index.find('figure', 't1')).toBeNull()
  expect(index.entries.map((entry) => `${entry.label} ${entry.caption}`)).toEqual([
    '图 1-1 甲', '表 1-1 表一', '图 1-2 乙', '图 1-3 丙', '图 2-1 丁', '表 2-1 表二',
  ])
  expect(index.start('a1')).toEqual({ chapter: 1, figures: 1, tables: 1 })
  expect(index.start('b')).toEqual({ chapter: 2, figures: 0, tables: 0 })
  expect(index.entries.find((entry) => entry.caption === '丙')?.index).toBe(1)
})

test('章节中的标注从给定的编号开始', () => {
  const doc = parseMarkdown(docs.a1)
  expect([...chapterLabels(doc, { chapter: 1, figures: 1, tables: 1 }).values()]).toEqual(['图 1-2', '图 1-3'])
  expect([...chapterLabels(doc, { chapter: null, figures: 0, tables: 0 }).values()]).toEqual(['图 1', '图 2'])
})
