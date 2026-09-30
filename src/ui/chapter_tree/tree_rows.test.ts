import { expect, test } from 'vitest'
import type { ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { ancestorPath, numberWidths, visibleRows } from './tree_rows.ts'

const outline: ChapterTree = [
  {
    id: 'a',
    title: 'A',
    children: [
      { id: 'b', title: 'B', children: [{ id: 'c', title: 'C', children: [] }] },
      { id: 'd', title: 'D', children: [] },
    ],
  },
  { id: 'e', title: 'E', children: [] },
]

test('按先序摊平，带编号与层级', () => {
  expect(visibleRows(outline, new Set())).toEqual([
    { id: 'a', title: 'A', number: '1', depth: 0, hasChildren: true },
    { id: 'b', title: 'B', number: '1.1', depth: 1, hasChildren: true },
    { id: 'c', title: 'C', number: '1.1.1', depth: 2, hasChildren: false },
    { id: 'd', title: 'D', number: '1.2', depth: 1, hasChildren: false },
    { id: 'e', title: 'E', number: '2', depth: 0, hasChildren: false },
  ])
})

test('折叠的章节不展开后代，编号不受影响', () => {
  const rows = visibleRows(outline, new Set(['b']))
  expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'd', 'e'])
  expect(rows.find((row) => row.id === 'd')?.number).toBe('1.2')
  expect(visibleRows(outline, new Set(['a'])).map((row) => row.id)).toEqual(['a', 'e'])
})

test('祖先路径从根开始，不含自身；找不到时为 null', () => {
  expect(ancestorPath(outline, 'c')).toEqual(['a', 'b'])
  expect(ancestorPath(outline, 'e')).toEqual([])
  expect(ancestorPath(outline, 'missing')).toBeNull()
})

test('同一父章节下的编号宽度按其中最长的编号', () => {
  const tree: ChapterTree = [
    {
      id: 'p',
      title: 'P',
      children: Array.from({ length: 10 }, (_, index) => ({ id: `s${index + 1}`, title: '', children: [] })),
    },
  ]
  const widths = numberWidths(visibleRows(tree, new Set()))
  // "1.9" 与 "1.10" 同宽：3 个数字 + 一级的分隔点。
  expect(widths.get('s9')).toBe('calc(3ch + 1 * 0.3em)')
  expect(widths.get('s10')).toBe('calc(3ch + 1 * 0.3em)')
  expect(widths.get('p')).toBe('calc(1ch + 0 * 0.3em)')
})
