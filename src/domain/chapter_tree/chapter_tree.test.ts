import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateTree } from './chapter_tree.ts'
import type { ChapterTree, TreeIssue } from './chapter_tree.ts'

const valid: ChapterTree = [
  {
    id: 'c1',
    title: '第一章',
    children: [
      { id: 'c1-1', title: '1.1', children: [] },
      { id: 'c1-2', title: '1.2', children: [{ id: 'c1-2-1', title: '1.2.1', children: [] }] },
    ],
  },
  { id: 'c2', title: '第二章', children: [] },
]

/** 断言校验失败并取出问题列表。 */
function issuesOf(tree: unknown): TreeIssue[] {
  const result = validateTree(tree)
  assert.equal(result.ok, false)
  return result.ok ? [] : result.issues
}

test('合法树成功，并得到可信的 ChapterTree', () => {
  const result = validateTree(valid)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.tree, valid)
  assert.equal(result.tree[0].children[1].children[0].id, 'c1-2-1')
})

test('空树成功', () => {
  const result = validateTree([])
  assert.equal(result.ok, true)
})

test('根不是数组', () => {
  const issues = issuesOf({ id: 'c1', title: 'x', children: [] })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].path, 'root')
})

test('id 全局唯一：跨分支重复也能发现', () => {
  const issues = issuesOf([
    { id: 'dup', title: 'a', children: [] },
    { id: 'dup', title: 'b', children: [] },
  ])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].path, '[1]')
  assert.match(issues[0].message, /id 重复/)
})

test('id 为空字符串非法', () => {
  const issues = issuesOf([{ id: '', title: 'a', children: [] }])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].path, '[0]')
})

test('id 类型错误非法', () => {
  assert.equal(issuesOf([{ id: 1, title: 'a', children: [] }]).length, 1)
})

test('title 必须是字符串', () => {
  const issues = issuesOf([{ id: 'c1', title: 42, children: [] }])
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /title/)
})

test('children 必须是数组', () => {
  const issues = issuesOf([{ id: 'c1', title: 'a', children: null }])
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /children/)
})

test('子节点非对象，路径带层级', () => {
  const issues = issuesOf([{ id: 'c1', title: 'a', children: ['oops'] }])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].path, '[0].children[0]')
})

test('循环引用可安全遍历并报错', () => {
  const a: any = { id: 'a', title: 'a', children: [] }
  const b: any = { id: 'b', title: 'b', children: [a] }
  a.children.push(b)

  const issues = issuesOf([a])
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /循环|共享/)
})

test('同一节点被两个父节点共享 = 非树', () => {
  const shared: any = { id: 'shared', title: 'shared', children: [] }
  const issues = issuesOf([
    { id: 'p1', title: 'p1', children: [shared] },
    { id: 'p2', title: 'p2', children: [shared] },
  ])
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /循环|共享/)
})
