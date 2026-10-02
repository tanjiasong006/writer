import { expect, test } from 'vitest'
import type { ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { chapterRefLabels } from './chapter_ref_view.ts'
import { countRefsTo, updateChapterRefs } from './chapter_ref_update.ts'

const tree: ChapterTree = [
  { id: 'a', title: '绪论', children: [{ id: 'a1', title: '背景', children: [] }] },
  { id: 'b', title: '方法', children: [] },
]
const label = chapterRefLabels(tree)

test('只重写链接文字过期的章节；失效引用带位置与上下文报告', () => {
  const contents = new Map([
    ['a', '见[2 方法](writer:chapter/b)，这是最新的。\n'],
    ['a1', '* 列表\n\n见[旧编号](writer:chapter/b?show=number)与[原来的讨论](writer:chapter/gone)一节，后面还有很长很长的一段文字。\n'],
    ['b', '`[x](writer:chapter/gone)` 是代码，不算引用。\n\n[坏](writer:chapter/)\n'],
  ])
  const result = updateChapterRefs(['a', 'a1', 'b'], contents, label)
  expect(result.updated).toBe(1)
  // 整体按统一风格重新写出（列表符号也被规范化，已接受）。
  expect([...result.texts]).toEqual([
    ['a1', '- 列表\n\n见[2](writer:chapter/b?show=number)与[原来的讨论](writer:chapter/gone)一节，后面还有很长很长的一段文字。\n'],
  ])
  expect(result.broken).toEqual([
    { chapterId: 'a1', index: 1, text: '原来的讨论', before: '见2与', after: '一节，后面还有很长很长的一段文字…' },
    { chapterId: 'b', index: 0, text: '坏', before: '', after: '' },
  ])
})

test('都是最新的：没有要写回的章节', () => {
  const result = updateChapterRefs(['a'], new Map([['a', '见[2 方法](writer:chapter/b)\n']]), label)
  expect(result).toEqual({ texts: new Map(), updated: 0, broken: [] })
})

test('统计指向一组章节的引用，可以排除所在章节', () => {
  const contents = new Map([
    ['a', '[x](writer:chapter/a1)、[y](writer:chapter/b)、`[z](writer:chapter/a1)`'],
    ['a1', '[自己](writer:chapter/a1)'],
    ['b', '[x](writer:chapter/a)、[坏](writer:chapter/a1/x)'],
  ])
  const subtree = new Set(['a', 'a1'])
  expect(countRefsTo(contents, subtree, (id) => !subtree.has(id))).toBe(1)
  expect(countRefsTo(contents, new Set(['a1']))).toBe(2)
})
