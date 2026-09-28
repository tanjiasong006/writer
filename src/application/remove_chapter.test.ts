import { test } from 'vitest'
import assert from 'node:assert/strict'
import { removeChapter, selectionAfterRemove } from './remove_chapter.ts'
import { validateTree } from '../domain/chapter_tree/chapter_tree.ts'
import type { ChapterTree } from '../domain/chapter_tree/chapter_tree.ts'

const outline: ChapterTree = [
  {
    id: 'a',
    title: 'A',
    children: [
      { id: 'a1', title: 'A1', children: [] },
      { id: 'a2', title: 'A2', children: [{ id: 'a2x', title: 'A2X', children: [] }] },
    ],
  },
  { id: 'b', title: 'B', children: [] },
]

test('removeChapter：删除章节会一并删除整棵子树', () => {
  const result = removeChapter(outline, 'a2')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(validateTree(result.tree).ok, true)
  assert.deepEqual(result.tree[0].children.map((n) => n.id), ['a1'])
  assert.equal(result.tree[0].children.some((n) => n.id === 'a2x'), false)
})

test('removeChapter：章节不存在', () => {
  const result = removeChapter(outline, 'zzz')
  assert.equal(result.ok, false)
  assert.equal(result.ok ? '' : result.reason, 'chapter-not-found')
})

test('removeChapter：可以删到空树', () => {
  const once = removeChapter(outline, 'a')
  assert.equal(once.ok, true)
  if (!once.ok) return
  const twice = removeChapter(once.tree, 'b')
  assert.equal(twice.ok, true)
  if (!twice.ok) return
  assert.deepEqual(twice.tree, [])
})

test('removeChapter：不修改原树', () => {
  const snapshot = JSON.stringify(outline)
  removeChapter(outline, 'a')
  assert.equal(JSON.stringify(outline), snapshot)
})

test('selectionAfterRemove：下一个兄弟，否则上一个兄弟，否则父章节', () => {
  assert.equal(selectionAfterRemove(outline, 'a1'), 'a2')
  assert.equal(selectionAfterRemove(outline, 'a2'), 'a1')
  assert.equal(selectionAfterRemove(outline, 'a2x'), 'a2')
  assert.equal(selectionAfterRemove(outline, 'a'), 'b')
  assert.equal(selectionAfterRemove(outline, 'b'), 'a')
  assert.equal(selectionAfterRemove([{ id: 'x', title: 'X', children: [] }], 'x'), null)
  assert.equal(selectionAfterRemove(outline, 'missing'), null)
})
