import { test } from 'vitest'
import assert from 'node:assert/strict'
import { canMoveChapter, moveChapterTo } from './move_chapter.ts'
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

function childIds(tree: ChapterTree, id: string): string[] {
  const find = (list: ChapterTree): ChapterTree[number] | null => {
    for (const n of list) {
      if (n.id === id) return n
      const hit = find(n.children)
      if (hit) return hit
    }
    return null
  }
  return find(tree)!.children.map((n) => n.id)
}

function moved(
  tree: ChapterTree,
  chapterId: string,
  targetChapterId: string,
  position: 'before' | 'inside' | 'after',
): ChapterTree {
  const result = moveChapterTo(tree, { chapterId, targetChapterId, position })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('期望移动成功，但失败了')
  assert.equal(validateTree(result.tree).ok, true)
  return result.tree
}

function moveReason(
  tree: ChapterTree,
  chapterId: string,
  targetChapterId: string,
  position: 'before' | 'inside' | 'after',
): string {
  const result = moveChapterTo(tree, { chapterId, targetChapterId, position })
  assert.equal(result.ok, false)
  return result.ok ? '' : result.reason
}

test('before：放到目标章节前面的兄弟位置', () => {
  const next = moved(outline, 'b', 'a1', 'before')
  assert.deepEqual(childIds(next, 'a'), ['b', 'a1', 'a2'])
  assert.deepEqual(next.map((n) => n.id), ['a'])
})

test('after：放到目标章节后面的兄弟位置', () => {
  const next = moved(outline, 'a1', 'b', 'after')
  assert.deepEqual(next.map((n) => n.id), ['a', 'b', 'a1'])
  assert.deepEqual(childIds(next, 'a'), ['a2'])
})

test('before 同父且原位置在后，不需要前移', () => {
  const next = moved(outline, 'a2', 'a1', 'before')
  assert.deepEqual(childIds(next, 'a'), ['a2', 'a1'])
})

test('after 同父且原位置在前，index 按移除后前移一位', () => {
  const next = moved(outline, 'a1', 'a2', 'after')
  assert.deepEqual(childIds(next, 'a'), ['a2', 'a1'])
})

test('before 同父且已经在前，结果保持不变', () => {
  const next = moved(outline, 'a1', 'a2', 'before')
  assert.deepEqual(childIds(next, 'a'), ['a1', 'a2'])
})

test('inside：放进目标章节，作为最后一个子章节', () => {
  const next = moved(outline, 'b', 'a2', 'inside')
  assert.deepEqual(childIds(next, 'a2'), ['a2x', 'b'])
  assert.deepEqual(next.map((n) => n.id), ['a'])
})

test('inside 到原父章节时视为追加到末尾', () => {
  const next = moved(outline, 'a1', 'a', 'inside')
  assert.deepEqual(childIds(next, 'a'), ['a2', 'a1'])
})

test('inside 到自己身上被 Domain 拒绝', () => {
  assert.equal(moveReason(outline, 'a', 'a', 'inside'), 'target-is-descendant')
})

test('inside 到自己的后代被 Domain 拒绝', () => {
  assert.equal(moveReason(outline, 'a', 'a2x', 'inside'), 'target-is-descendant')
})

test('被移动章节不存在', () => {
  assert.equal(moveReason(outline, 'zzz', 'a1', 'before'), 'chapter-not-found')
})

test('目标章节不存在', () => {
  assert.equal(moveReason(outline, 'a1', 'zzz', 'before'), 'target-not-found')
})

test('移动不修改原树', () => {
  const snapshot = JSON.stringify(outline)
  moveChapterTo(outline, { chapterId: 'b', targetChapterId: 'a1', position: 'before' })
  assert.equal(JSON.stringify(outline), snapshot)
})

// --- canMoveChapter：UI 落点有效性 ---

test('canMoveChapter：目标是自身时一律无效', () => {
  assert.equal(canMoveChapter(outline, { chapterId: 'a1', targetChapterId: 'a1', position: 'before' }), false)
  assert.equal(canMoveChapter(outline, { chapterId: 'a1', targetChapterId: 'a1', position: 'after' }), false)
  assert.equal(canMoveChapter(outline, { chapterId: 'a1', targetChapterId: 'a1', position: 'inside' }), false)
})

test('canMoveChapter：目标是自身后代时无效', () => {
  assert.equal(canMoveChapter(outline, { chapterId: 'a', targetChapterId: 'a2', position: 'before' }), false)
  assert.equal(canMoveChapter(outline, { chapterId: 'a', targetChapterId: 'a2x', position: 'inside' }), false)
})

test('canMoveChapter：落点与当前位置相同视为 no-op', () => {
  // a1 紧挨在 a2 前面，放到 a2 前面仍是原位。
  assert.equal(canMoveChapter(outline, { chapterId: 'a1', targetChapterId: 'a2', position: 'before' }), false)
  // a2 紧跟在 a1 后面，放到 a1 后面仍是原位。
  assert.equal(canMoveChapter(outline, { chapterId: 'a2', targetChapterId: 'a1', position: 'after' }), false)
  // a2 已经是 a 的最后一个子章节，inside 到 a 仍是原位。
  assert.equal(canMoveChapter(outline, { chapterId: 'a2', targetChapterId: 'a', position: 'inside' }), false)
})

test('canMoveChapter：真正改变位置的落点有效', () => {
  assert.equal(canMoveChapter(outline, { chapterId: 'a1', targetChapterId: 'a2', position: 'after' }), true)
  assert.equal(canMoveChapter(outline, { chapterId: 'a2', targetChapterId: 'a1', position: 'before' }), true)
  assert.equal(canMoveChapter(outline, { chapterId: 'b', targetChapterId: 'a1', position: 'before' }), true)
  assert.equal(canMoveChapter(outline, { chapterId: 'a1', targetChapterId: 'a2', position: 'inside' }), true)
})

test('canMoveChapter：找不到章节时无效', () => {
  assert.equal(canMoveChapter(outline, { chapterId: 'zzz', targetChapterId: 'a1', position: 'before' }), false)
  assert.equal(canMoveChapter(outline, { chapterId: 'a1', targetChapterId: 'zzz', position: 'before' }), false)
})

test('canMoveChapter：inside 到原父章节不是最后一个时有效', () => {
  // a1 不是 a 的最后一个子章节，inside 到 a 会移到末尾。
  assert.equal(canMoveChapter(outline, { chapterId: 'a1', targetChapterId: 'a', position: 'inside' }), true)
})

/** 递归冻结，能在校验尝试原地修改树时立即报错。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

test('canMoveChapter：只读校验，不修改也不重建输入树', () => {
  const snapshot = JSON.stringify(outline)
  const frozen = deepFreeze(structuredClone(outline))

  // 冻结输入下仍能得出正确结论，说明没有原地写入。
  assert.equal(canMoveChapter(frozen, { chapterId: 'a1', targetChapterId: 'a2', position: 'after' }), true)
  assert.equal(canMoveChapter(frozen, { chapterId: 'a', targetChapterId: 'a2', position: 'before' }), false)

  // 返回布尔值而非新树，原树内容与引用都不变。
  assert.equal(JSON.stringify(frozen), snapshot)
  assert.equal(JSON.stringify(outline), snapshot)
})
