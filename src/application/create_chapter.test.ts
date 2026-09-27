import { test } from 'vitest'
import assert from 'node:assert/strict'
import { appendChapter, createChapter } from './create_chapter.ts'
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

function created(tree: ChapterTree, parent: string | null, index: number, title: string) {
  const result = createChapter(tree, parent, index, title)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('期望新建成功，但失败了')
  assert.equal(validateTree(result.tree).ok, true)
  return result
}

function createReason(tree: ChapterTree, parent: string | null, index: number): string {
  const result = createChapter(tree, parent, index, 'X')
  assert.equal(result.ok, false)
  return result.ok ? '' : result.reason
}

test('在根层级新建章节', () => {
  const { tree, chapterId } = created(outline, null, 1, '新章节')
  assert.deepEqual(tree.map((n) => n.id), ['a', chapterId, 'b'])
  const node = tree.find((n) => n.id === chapterId)!
  assert.equal(node.title, '新章节')
  assert.deepEqual(node.children, [])
})

test('在指定父章节下新建章节', () => {
  const { tree, chapterId } = created(outline, 'a', 1, '新章节')
  assert.deepEqual(childIds(tree, 'a'), ['a1', chapterId, 'a2'])
  assert.deepEqual(childIds(tree, 'a2'), ['a2x'])
})

test('指定插入位置', () => {
  const first = created(outline, null, 0, '头')
  assert.equal(first.tree[0].id, first.chapterId)

  const last = created(outline, 'a', 2, '尾')
  assert.deepEqual(childIds(last.tree, 'a'), ['a1', 'a2', last.chapterId])
})

test('父章节不存在', () => {
  assert.equal(createReason(outline, 'zzz', 0), 'parent-not-found')
})

test('index 非法', () => {
  assert.equal(createReason(outline, null, -1), 'index-out-of-range')
  assert.equal(createReason(outline, null, outline.length + 1), 'index-out-of-range')
  assert.equal(createReason(outline, null, 1.5), 'index-out-of-range')
  assert.equal(createReason(outline, 'a', 3), 'index-out-of-range')
})

test('每次新建生成不同的非空 id，且确实进入树中', () => {
  const first = created(outline, null, 0, '一')
  const second = created(first.tree, null, 0, '二')
  assert.notEqual(first.chapterId, second.chapterId)
  assert.ok(first.chapterId.length > 0)
  assert.ok(second.tree.some((n) => n.id === second.chapterId))
})

test('新建不修改原树', () => {
  const snapshot = JSON.stringify(outline)
  createChapter(outline, 'a', 0, 'X')
  assert.equal(JSON.stringify(outline), snapshot)
})

// --- appendChapter ---

test('appendChapter：追加到根层级末尾', () => {
  const result = appendChapter(outline, null, '新根')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(validateTree(result.tree).ok, true)
  assert.deepEqual(
    result.tree.map((n) => n.id),
    ['a', 'b', result.chapterId],
  )
  assert.equal(result.tree.find((n) => n.id === result.chapterId)!.title, '新根')
})

test('appendChapter：追加到指定父章节末尾', () => {
  const result = appendChapter(outline, 'a', '新子')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(childIds(result.tree, 'a'), ['a1', 'a2', result.chapterId])
})

test('appendChapter：父章节不存在', () => {
  const result = appendChapter(outline, 'zzz', 'X')
  assert.equal(result.ok, false)
  assert.equal(result.ok ? '' : result.reason, 'parent-not-found')
})

test('appendChapter：不修改原树', () => {
  const snapshot = JSON.stringify(outline)
  appendChapter(outline, 'a', '新子')
  assert.equal(JSON.stringify(outline), snapshot)
})
