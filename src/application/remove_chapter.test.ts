import { test } from 'vitest'
import assert from 'node:assert/strict'
import { describeRemoval, removeChapter, restoreRemovedChapter, selectionAfterRemove } from './remove_chapter.ts'
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

test('撤销删除：章节连同子树回到原来的父章节与位置', () => {
  const removed = describeRemoval(outline, 'a2')
  assert.deepEqual(removed && { parentId: removed.parentId, index: removed.index }, { parentId: 'a', index: 1 })
  const after = removeChapter(outline, 'a2')
  assert.equal(after.ok, true)
  if (!after.ok || !removed) return
  const restored = restoreRemovedChapter(after.tree, removed)
  assert.equal(restored.ok, true)
  if (!restored.ok) return
  assert.deepEqual(restored.tree, outline)
})

test('撤销删除：之后的结构修改保留；原父章节不在时放到根层级末尾，原位置超出时放到末尾', () => {
  const first = describeRemoval(outline, 'a1')!
  const withoutA1 = removeChapter(outline, 'a1')
  assert.equal(withoutA1.ok, true)
  if (!withoutA1.ok) return
  const withoutA = removeChapter(withoutA1.tree, 'a')
  assert.equal(withoutA.ok, true)
  if (!withoutA.ok) return
  const restored = restoreRemovedChapter(withoutA.tree, first)
  assert.equal(restored.ok, true)
  if (!restored.ok) return
  assert.deepEqual(restored.tree.map((node) => node.id), ['b', 'a1'])

  const last = describeRemoval(outline, 'b')!
  const shorter = removeChapter(outline, 'a')
  if (!shorter.ok) return
  const withoutB = removeChapter(shorter.tree, 'b')
  if (!withoutB.ok) return
  const back = restoreRemovedChapter(withoutB.tree, last)
  assert.equal(back.ok, true)
  if (back.ok) assert.deepEqual(back.tree.map((node) => node.id), ['b'])
})

test('describeRemoval：章节不存在时为 null', () => {
  assert.equal(describeRemoval(outline, 'zzz'), null)
})
