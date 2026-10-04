import { expect, test } from 'vitest'
import { setChapterMeta, validateTree, type ChapterTree } from './chapter_tree.ts'

const tree: ChapterTree = [{ id: 'a', title: '一', children: [{ id: 'a1', title: '一一', children: [] }] }]

test('设置与去掉状态和备注；其他字段与结构不变', () => {
  const marked = setChapterMeta(tree, 'a1', { status: 'revise', note: '  补充数据来源  ' })
  expect(marked.ok && marked.tree[0].children[0]).toEqual({ id: 'a1', title: '一一', status: 'revise', note: '补充数据来源', children: [] })
  if (!marked.ok) return
  const cleared = setChapterMeta(marked.tree, 'a1', { status: null, note: ' ' })
  expect(cleared.ok && cleared.tree).toEqual(tree)
  const onlyStatus = setChapterMeta(marked.tree, 'a1', { status: 'done' })
  expect(onlyStatus.ok && onlyStatus.tree[0].children[0].note).toBe('补充数据来源')
  expect(setChapterMeta(tree, 'x', { status: 'done' })).toEqual({ ok: false, reason: 'chapter-not-found' })
})

test('校验：未知状态或备注不是字符串时拒绝', () => {
  expect(validateTree([{ id: 'a', title: '一', status: 'done', note: '备注', children: [] }]).ok).toBe(true)
  expect(validateTree([{ id: 'a', title: '一', status: 'finished', children: [] }])).toEqual({
    ok: false,
    issues: [{ path: '[0]', code: 'status-invalid' }],
  })
  expect(validateTree([{ id: 'a', title: '一', note: 1, children: [] }]).ok).toBe(false)
})
