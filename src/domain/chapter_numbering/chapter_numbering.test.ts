import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeChapterNumbers } from './chapter_numbering.ts'
import { validateTree } from '../chapter_tree/chapter_tree.ts'
import type { ChapterNode, ChapterTree } from '../chapter_tree/chapter_tree.ts'

const sample: ChapterTree = [
  {
    id: 'a',
    title: 'A',
    children: [
      {
        id: 'b',
        title: 'B',
        children: [{ id: 'c', title: 'C', children: [] }],
      },
      { id: 'd', title: 'D', children: [] },
    ],
  },
  { id: 'e', title: 'E', children: [] },
]

/** 取编号并转成 "1.1" 形式的显示字符串，方便断言。 */
function display(tree: ChapterTree): Record<string, string> {
  return Object.fromEntries(
    [...computeChapterNumbers(tree)].map(([id, n]) => [id, n.join('.')]),
  )
}

test('题目示例：根、子、兄弟、跨根分支', () => {
  assert.deepEqual(display(sample), {
    a: '1',
    b: '1.1',
    c: '1.1.1',
    d: '1.2',
    e: '2',
  })
})

test('根章节从 1 连续递增', () => {
  const tree: ChapterTree = [
    { id: 'x', title: '', children: [] },
    { id: 'y', title: '', children: [] },
    { id: 'z', title: '', children: [] },
  ]
  assert.deepEqual(display(tree), { x: '1', y: '2', z: '3' })
})

test('多层嵌套按深度累加层级', () => {
  const leaf: ChapterNode = { id: 'l4', title: '', children: [] }
  const tree: ChapterTree = [
    {
      id: 'l1',
      title: '',
      children: [{ id: 'l2', title: '', children: [{ id: 'l3', title: '', children: [leaf] }] }],
    },
  ]
  assert.deepEqual(display(tree), {
    l1: '1',
    l2: '1.1',
    l3: '1.1.1',
    l4: '1.1.1.1',
  })
})

test('空树返回空 Map', () => {
  const numbers = computeChapterNumbers([])
  assert.equal(numbers.size, 0)
})

test('键集与树中章节一一对应', () => {
  assert.deepEqual([...computeChapterNumbers(sample).keys()].sort(), ['a', 'b', 'c', 'd', 'e'])
})

test('不修改传入的树，也不依赖 title', () => {
  const snapshot = JSON.stringify(sample)
  computeChapterNumbers(sample)
  assert.equal(JSON.stringify(sample), snapshot)
})

test('编号是从 1 开始的整数数组', () => {
  for (const [number, id] of [...computeChapterNumbers(sample)].map(
    ([id, number]) => [number, id] as const,
  )) {
    assert.ok(number.length >= 1)
    assert.ok(number.every((n) => Number.isInteger(n) && n >= 1), id)
  }
})
