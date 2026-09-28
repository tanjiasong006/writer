import { expect, test } from 'vitest'
import type { ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { restoreUiState, serializeUiState } from './ui_state.ts'

const tree: ChapterTree = [
  { id: 'a', title: 'A', children: [{ id: 'a1', title: 'A1', children: [] }] },
  { id: 'b', title: 'B', children: [] },
]

test('往返：选中章节与折叠状态', () => {
  const text = serializeUiState({ selectedId: 'a1', collapsedIds: new Set(['a']) })
  const state = restoreUiState(text, tree)
  expect(state.selectedId).toBe('a1')
  expect([...state.collapsedIds]).toEqual(['a'])
})

test('没有状态或状态损坏：默认选中第一个章节', () => {
  for (const text of [null, '', '{', '[]', 'null', '{"version":99,"selectedId":"b"}']) {
    const state = restoreUiState(text, tree)
    expect(state.selectedId).toBe('a')
    expect(state.collapsedIds.size).toBe(0)
  }
})

test('引用已不存在的章节：丢弃对应部分', () => {
  const state = restoreUiState(
    JSON.stringify({ version: 1, selectedId: 'ghost', collapsedIds: ['a', 'ghost', 3] }),
    tree,
  )
  expect(state.selectedId).toBe('a')
  expect([...state.collapsedIds]).toEqual(['a'])
})

test('空文档：没有选中章节', () => {
  expect(restoreUiState(null, []).selectedId).toBeNull()
})
