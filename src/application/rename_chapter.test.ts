import { test } from 'vitest'
import assert from 'node:assert/strict'
import { renameChapter } from './rename_chapter.ts'
import { validateTree } from '../domain/chapter_tree/chapter_tree.ts'
import type { ChapterTree } from '../domain/chapter_tree/chapter_tree.ts'

const outline: ChapterTree = [
  {
    id: 'a',
    title: 'A',
    children: [
      { id: 'a1', title: 'A1', children: [] },
      { id: 'a2', title: 'A2', children: [] },
    ],
  },
  { id: 'b', title: 'B', children: [] },
]

test('renameChapter：只改标题，不动结构', () => {
  const result = renameChapter(outline, 'a', '新标题')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(validateTree(result.tree).ok, true)
  assert.equal(result.tree[0].title, '新标题')
  assert.deepEqual(result.tree.map((n) => n.id), ['a', 'b'])
  assert.deepEqual(result.tree[0].children.map((n) => n.id), ['a1', 'a2'])
})

test('renameChapter：空标题合法', () => {
  const result = renameChapter(outline, 'b', '')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.tree.find((n) => n.id === 'b')!.title, '')
})

test('renameChapter：章节不存在', () => {
  const result = renameChapter(outline, 'zzz', 'x')
  assert.equal(result.ok, false)
  assert.equal(result.ok ? '' : result.reason, 'chapter-not-found')
})

test('renameChapter：不修改原树', () => {
  const snapshot = JSON.stringify(outline)
  renameChapter(outline, 'a', '新标题')
  assert.equal(JSON.stringify(outline), snapshot)
})
