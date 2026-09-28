import { test } from 'vitest'
import assert from 'node:assert/strict'
import { MAX_CHAPTER_DEPTH, countDescendants, insertChapter, moveChapter, removeChapter, renameChapter, validateMove, validateTree } from './chapter_tree.ts'
import type { ChapterNode, ChapterTree, InsertReason, MoveReason, TreeIssue } from './chapter_tree.ts'

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
function issuesOf(tree: unknown): readonly TreeIssue[] {
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
  assert.equal(issues[0].code, 'not-an-array')
})

test('id 全局唯一：跨分支重复也能发现', () => {
  const issues = issuesOf([
    { id: 'dup', title: 'a', children: [] },
    { id: 'dup', title: 'b', children: [] },
  ])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].path, '[1]')
  assert.equal(issues[0].code, 'id-duplicate')
})

test('id 为空字符串非法', () => {
  const issues = issuesOf([{ id: '', title: 'a', children: [] }])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].path, '[0]')
  assert.equal(issues[0].code, 'id-invalid')
})

test('id 类型错误非法', () => {
  assert.equal(issuesOf([{ id: 1, title: 'a', children: [] }])[0].code, 'id-invalid')
})

test('title 必须是字符串', () => {
  const issues = issuesOf([{ id: 'c1', title: 42, children: [] }])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'title-invalid')
})

test('children 必须是数组', () => {
  const issues = issuesOf([{ id: 'c1', title: 'a', children: null }])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'children-invalid')
})

test('子节点非对象，路径带层级', () => {
  const issues = issuesOf([{ id: 'c1', title: 'a', children: ['oops'] }])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].path, '[0].children[0]')
  assert.equal(issues[0].code, 'node-not-object')
})

test('循环引用可安全遍历并报错', () => {
  const a: any = { id: 'a', title: 'a', children: [] }
  const b: any = { id: 'b', title: 'b', children: [a] }
  a.children.push(b)

  const issues = issuesOf([a])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'node-reused')
})

test('同一节点被两个父节点共享 = 非树', () => {
  const shared: any = { id: 'shared', title: 'shared', children: [] }
  const issues = issuesOf([
    { id: 'p1', title: 'p1', children: [shared] },
    { id: 'p2', title: 'p2', children: [shared] },
  ])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'node-reused')
})

// --- moveChapter ---

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

function moved(
  tree: ChapterTree,
  id: string,
  target: string | null,
  index: number,
): ChapterTree {
  const result = moveChapter(tree, id, target, index)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('期望移动成功，但失败了')
  assert.equal(validateTree(result.tree).ok, true)
  return result.tree
}

function moveReason(tree: ChapterTree, id: string, target: string | null, index: number): MoveReason {
  const result = moveChapter(tree, id, target, index)
  assert.equal(result.ok, false)
  return result.ok ? 'chapter-not-found' : result.reason
}

const childIds = (tree: ChapterTree, id: string): string[] => {
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

test('同层移动：摘下来再插回去，index 按移除后计算', () => {
  const next = moved(outline, 'a1', 'a', 1)
  assert.deepEqual(childIds(next, 'a'), ['a2', 'a1'])
  assert.deepEqual(next.map((n) => n.id), ['a', 'b'])
})

test('移动到另一个父节点下', () => {
  const next = moved(outline, 'b', 'a2', 0)
  assert.deepEqual(childIds(next, 'a2'), ['b', 'a2x'])
  assert.deepEqual(next.map((n) => n.id), ['a'])
})

test('移动到根层级', () => {
  const next = moved(outline, 'a1', null, 0)
  assert.deepEqual(next.map((n) => n.id), ['a1', 'a', 'b'])
})

test('移动保留整棵子树', () => {
  const next = moved(outline, 'a2', null, 2)
  const a2 = next.find((n) => n.id === 'a2')!
  assert.deepEqual(a2.children.map((n) => n.id), ['a2x'])
  assert.deepEqual(next.map((n) => n.id), ['a', 'b', 'a2'])
})

test('不修改传入的树', () => {
  const snapshot = JSON.stringify(outline)
  moveChapter(outline, 'a1', null, 0)
  assert.equal(JSON.stringify(outline), snapshot)
})

test('移动失败的原因', () => {
  assert.equal(moveReason(outline, 'zzz', null, 0), 'chapter-not-found')
  assert.equal(moveReason(outline, 'a1', 'zzz', 0), 'target-not-found')
  assert.equal(moveReason(outline, 'a', 'a2', 0), 'target-is-descendant')
  assert.equal(moveReason(outline, 'a', 'a', 0), 'target-is-descendant')
  assert.equal(moveReason(outline, 'a1', 'a', 3), 'index-out-of-range')
  assert.equal(moveReason(outline, 'a1', 'a', -1), 'index-out-of-range')
  assert.equal(moveReason(outline, 'a1', 'a', 1.5), 'index-out-of-range')
})

// --- validateMove：移动规则的唯一实现 ---

test('validateMove：合法移动返回 null', () => {
  assert.equal(validateMove(outline, 'a1', 'a', 1), null)
  assert.equal(validateMove(outline, 'a1', null, 0), null)
  assert.equal(validateMove(outline, 'b', 'a2', 0), null)
})

test('validateMove：原因与 moveChapter 一致', () => {
  assert.equal(validateMove(outline, 'zzz', null, 0), 'chapter-not-found')
  assert.equal(validateMove(outline, 'a1', 'zzz', 0), 'target-not-found')
  assert.equal(validateMove(outline, 'a', 'a2', 0), 'target-is-descendant')
  assert.equal(validateMove(outline, 'a', 'a', 0), 'target-is-descendant')
  assert.equal(validateMove(outline, 'a1', 'a', 3), 'index-out-of-range')
  assert.equal(validateMove(outline, 'a1', 'a', -1), 'index-out-of-range')
  assert.equal(validateMove(outline, 'a1', 'a', 1.5), 'index-out-of-range')
})

test('validateMove：同父移动按移除后的长度判定', () => {
  // a 下有 a1、a2，移除 a1 后长度为 1，index 1 合法（追加到 a2 之后）。
  assert.equal(validateMove(outline, 'a1', 'a', 1), null)
  // index 2 超出移除后的范围。
  assert.equal(validateMove(outline, 'a1', 'a', 2), 'index-out-of-range')
})

test('validateMove：只读，不修改输入树', () => {
  const snapshot = JSON.stringify(outline)
  validateMove(outline, 'a1', 'a', 1)
  validateMove(outline, 'a', 'a2', 0)
  assert.equal(JSON.stringify(outline), snapshot)
})

// --- insertChapter / removeChapter / renameChapter ---

function chapter(id: string, title = id, children: ChapterNode[] = []): ChapterNode {
  return { id, title, children }
}

/** 断言操作成功、结果树通过校验，并返回结果树。 */
function expectValid(
  result: { ok: true; tree: ChapterTree } | { ok: false; reason: string },
): ChapterTree {
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('期望成功，但操作失败了')
  const validated = validateTree(result.tree)
  assert.equal(validated.ok, true)
  return result.tree
}

function insertReason(
  tree: ChapterTree,
  parent: string | null,
  index: number,
  node: ChapterNode,
): string {
  const result = insertChapter(tree, parent, index, node)
  assert.equal(result.ok, false)
  return result.ok ? '' : result.reason
}

test('插入到根层级', () => {
  const next = expectValid(insertChapter(outline, null, 1, chapter('c')))
  assert.deepEqual(next.map((n) => n.id), ['a', 'c', 'b'])
})

test('插入到指定父节点下', () => {
  const next = expectValid(insertChapter(outline, 'a', 1, chapter('c')))
  assert.deepEqual(childIds(next, 'a'), ['a1', 'c', 'a2'])
})

test('index 等于长度即追加', () => {
  const atRoot = expectValid(insertChapter(outline, null, outline.length, chapter('c')))
  assert.deepEqual(atRoot.map((n) => n.id), ['a', 'b', 'c'])
  const underA = expectValid(insertChapter(outline, 'a', 2, chapter('c')))
  assert.deepEqual(childIds(underA, 'a'), ['a1', 'a2', 'c'])
})

test('插入带子树的节点，结构完整保留', () => {
  const subtree = chapter('c', 'C', [chapter('c1'), chapter('c2', 'C2', [chapter('c2x')])])
  const next = expectValid(insertChapter(outline, null, 0, subtree))
  assert.deepEqual(next.map((n) => n.id), ['c', 'a', 'b'])
  assert.deepEqual(childIds(next, 'c'), ['c1', 'c2'])
  assert.deepEqual(childIds(next, 'c2'), ['c2x'])
})

test('插入不修改原树', () => {
  const snapshot = JSON.stringify(outline)
  insertChapter(outline, 'a', 0, chapter('c'))
  assert.equal(JSON.stringify(outline), snapshot)
})

test('插入失败的原因', () => {
  assert.equal(insertReason(outline, 'zzz', 0, chapter('c')), 'parent-not-found')
  assert.equal(insertReason(outline, null, -1, chapter('c')), 'index-out-of-range')
  assert.equal(insertReason(outline, null, 3, chapter('c')), 'index-out-of-range')
  assert.equal(insertReason(outline, null, 1.5, chapter('c')), 'index-out-of-range')
  assert.equal(insertReason(outline, null, 0, chapter('a1')), 'id-duplicate')
  assert.equal(
    insertReason(outline, null, 0, chapter('c', 'C', [chapter('a')])),
    'id-duplicate',
  )
  // 待插入子树内部重复 id（Set 去重会漏掉，必须单独发现）
  assert.equal(
    insertReason(outline, null, 0, chapter('c', 'C', [chapter('c1'), chapter('c1')])),
    'id-duplicate',
  )
  assert.equal(
    insertReason(outline, null, 0, chapter('c', 'C', [chapter('c1', 'C1', [chapter('c1')])])),
    'id-duplicate',
  )
})

test('插入拒绝空字符串 id', () => {
  assert.equal(insertReason(outline, null, 0, chapter('')), 'id-invalid')
})

test('插入拒绝子树内部的循环引用', () => {
  const cyclic: any = chapter('cyc')
  cyclic.children.push(cyclic)
  assert.equal(insertReason(outline, null, 0, cyclic), 'node-reused')
})

test('插入拒绝共享节点', () => {
  const shared = chapter('shared')
  const subtree = chapter('c', 'C', [shared, shared])
  assert.equal(insertReason(outline, null, 0, subtree), 'node-reused')
})

test('插入失败时原树保持不变', () => {
  const cyclic: any = chapter('cyc')
  cyclic.children.push(cyclic)
  const snapshot = JSON.stringify(outline)

  assert.equal(insertChapter(outline, null, 0, cyclic).ok, false)
  assert.equal(insertChapter(outline, null, 0, chapter('')).ok, false)
  assert.equal(insertChapter(outline, null, 0, chapter('a1')).ok, false)

  assert.equal(JSON.stringify(outline), snapshot)
})

test('InsertReason 不含 not-an-array：子树以 [node] 数组校验', () => {
  // 类型层断言：若 InsertReason 又收进 not-an-array，@ts-expect-error 会因未使用而报错。
  // @ts-expect-error insertChapter 的子树以数组校验，不会返回 not-an-array
  const impossible: InsertReason = 'not-an-array'
  void impossible
})

test('删除根层节点', () => {
  const next = expectValid(removeChapter(outline, 'a'))
  assert.deepEqual(next.map((n) => n.id), ['b'])
})

test('删除嵌套节点', () => {
  const next = expectValid(removeChapter(outline, 'a1'))
  assert.deepEqual(childIds(next, 'a'), ['a2'])
})

test('删除带子树的节点会一并删除', () => {
  const next = expectValid(removeChapter(outline, 'a2'))
  assert.deepEqual(childIds(next, 'a'), ['a1'])
  assert.deepEqual(next.map((n) => n.id), ['a', 'b'])
})

test('全部删除得到合法空树', () => {
  const once = expectValid(removeChapter(outline, 'a'))
  const next = expectValid(removeChapter(once, 'b'))
  assert.deepEqual(next, [])
})

test('删除不修改原树', () => {
  const snapshot = JSON.stringify(outline)
  removeChapter(outline, 'a2')
  assert.equal(JSON.stringify(outline), snapshot)
})

test('删除不存在的章节', () => {
  const result = removeChapter(outline, 'zzz')
  assert.equal(result.ok, false)
  assert.equal(result.ok ? '' : result.reason, 'chapter-not-found')
})

test('重命名根层节点', () => {
  const next = expectValid(renameChapter(outline, 'a', '新标题'))
  assert.equal(next.find((n) => n.id === 'a')!.title, '新标题')
})

test('重命名嵌套节点，children 和位置不变', () => {
  const next = expectValid(renameChapter(outline, 'a2', '新标题'))
  assert.deepEqual(next.map((n) => n.id), ['a', 'b'])
  assert.equal(childIds(next, 'a').join(','), 'a1,a2')
  assert.deepEqual(childIds(next, 'a2'), ['a2x'])
  const find = next[0].children.find((n) => n.id === 'a2')!
  assert.equal(find.title, '新标题')
})

test('空字符串 title 合法', () => {
  const next = expectValid(renameChapter(outline, 'b', ''))
  assert.equal(next.find((n) => n.id === 'b')!.title, '')
})

test('重命名不修改原树', () => {
  const snapshot = JSON.stringify(outline)
  renameChapter(outline, 'a', '新标题')
  assert.equal(JSON.stringify(outline), snapshot)
})

test('重命名不存在的章节', () => {
  const result = renameChapter(outline, 'zzz', 'x')
  assert.equal(result.ok ? '' : result.reason, 'chapter-not-found')
})

/** 一条深度为 depth 的单链：id 为 d1..d{depth}。 */
function chain(depth: number, prefix = 'd'): ChapterNode {
  let node: ChapterNode = { id: `${prefix}${depth}`, title: '', children: [] }
  for (let i = depth - 1; i >= 1; i--) node = { id: `${prefix}${i}`, title: '', children: [node] }
  return node
}

test('validateTree：恰好 MAX_CHAPTER_DEPTH 层合法', () => {
  assert.equal(validateTree([chain(MAX_CHAPTER_DEPTH)]).ok, true)
})

test('validateTree：超过层级上限报告 depth-exceeded，并停止深入', () => {
  const issues = issuesOf([chain(MAX_CHAPTER_DEPTH + 1)])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'depth-exceeded')
})

test('validateTree：极深的异常输入不会耗尽调用栈', () => {
  let raw: unknown = { id: 'leaf', title: '', children: [] }
  for (let i = 0; i < 100_000; i++) raw = { id: `n${i}`, title: '', children: [raw] }
  const issues = issuesOf([raw])
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ['depth-exceeded'],
  )
})

test('moveChapter：移动后超过层级上限时拒绝', () => {
  // 深链最底层是第 32 级；把一个两层的子树放进第 31 级会达到 33 级。
  const tree: ChapterTree = [chain(MAX_CHAPTER_DEPTH), chain(2, 'x')]
  assert.equal(validateMove(tree, 'x1', `d${MAX_CHAPTER_DEPTH - 1}`, 0), 'depth-exceeded')
  assert.deepEqual(moveChapter(tree, 'x1', `d${MAX_CHAPTER_DEPTH - 1}`, 0), {
    ok: false,
    reason: 'depth-exceeded',
  })
  // 放进第 30 级刚好到 32 级，合法。
  assert.equal(validateMove(tree, 'x1', `d${MAX_CHAPTER_DEPTH - 2}`, 0), null)
})

test('insertChapter：插入后超过层级上限时拒绝', () => {
  const tree: ChapterTree = [chain(MAX_CHAPTER_DEPTH)]
  const leaf: ChapterNode = { id: 'new', title: '', children: [] }
  assert.deepEqual(insertChapter(tree, `d${MAX_CHAPTER_DEPTH}`, 0, leaf), {
    ok: false,
    reason: 'depth-exceeded',
  })
  assert.equal(insertChapter(tree, `d${MAX_CHAPTER_DEPTH - 1}`, 0, leaf).ok, true)
})

test('countDescendants：统计全部后代，不含自身', () => {
  assert.equal(countDescendants(valid, 'c1'), 3)
  assert.equal(countDescendants(valid, 'c1-2'), 1)
  assert.equal(countDescendants(valid, 'c2'), 0)
  assert.equal(countDescendants(valid, 'ghost'), 0)
})
