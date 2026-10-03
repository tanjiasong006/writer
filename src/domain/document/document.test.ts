import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { ChapterTree } from '../chapter_tree/chapter_tree.ts'
import {
  createDocument,
  emptyDocument,
  hasContent,
  replaceTree,
  setContent,
  setDocumentInfo,
  setTitle,
} from './document.ts'

const tree: ChapterTree = [
  { id: 'a', title: '第一章', children: [{ id: 'a1', title: '背景', children: [] }] },
  { id: 'b', title: '第二章', children: [] },
]

const contents = new Map([
  ['a', '引言'],
  ['a1', ''],
  ['b', '正文\n'],
])

function doc() {
  const result = createDocument('论文', tree, contents)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('unreachable')
  return result.document
}

test('createDocument：正文与章节一一对应时成功', () => {
  const document = doc()
  assert.equal(document.title, '论文')
  assert.equal(document.contents.get('b'), '正文\n')
})

test('createDocument：缺少章节正文时失败并指出章节', () => {
  const partial = new Map(contents)
  partial.delete('a1')
  assert.deepEqual(createDocument('论文', tree, partial), {
    ok: false,
    reason: 'content-missing',
    chapterId: 'a1',
  })
})

test('createDocument：多出不属于任何章节的正文时失败', () => {
  const extra = new Map(contents)
  extra.set('ghost', 'x')
  assert.deepEqual(createDocument('论文', tree, extra), {
    ok: false,
    reason: 'content-orphan',
    chapterId: 'ghost',
  })
})

test('emptyDocument：空树、空正文，只有文档信息、结构与正文', () => {
  const document = emptyDocument('新文档')
  assert.deepEqual(document.tree, [])
  assert.equal(document.contents.size, 0)
  assert.deepEqual(Object.keys(document).sort(), ['author', 'contents', 'subtitle', 'title', 'tree'])
  assert.equal(document.subtitle, '')
  assert.equal(document.author, '')
})

test('replaceTree：删除子树时一并去掉子孙正文', () => {
  const next = replaceTree(doc(), [{ id: 'b', title: '第二章', children: [] }])
  assert.deepEqual([...next.contents.keys()], ['b'])
  assert.equal(next.contents.get('b'), '正文\n')
})

test('replaceTree：重新出现的章节（撤销删除）使用给出的正文，已有章节的正文不被覆盖', () => {
  const restored = new Map([
    ['new', '恢复的正文'],
    ['b', '不使用'],
  ])
  const next = replaceTree(doc(), [...doc().tree, { id: 'new', title: '恢复', children: [] }], restored)
  assert.equal(next.contents.get('new'), '恢复的正文')
  assert.equal(next.contents.get('b'), '正文\n')
})

test('replaceTree：新章节补空正文，移动不影响正文', () => {
  const moved: ChapterTree = [
    { id: 'b', title: '第二章', children: [{ id: 'a1', title: '背景', children: [] }] },
    { id: 'a', title: '第一章', children: [] },
    { id: 'new', title: '未命名章节', children: [] },
  ]
  const next = replaceTree(doc(), moved)
  assert.equal(next.contents.get('new'), '')
  assert.equal(next.contents.get('a'), '引言')
  assert.equal(next.contents.get('a1'), '')
  assert.equal(next.tree, moved)
})

test('replaceTree：不修改原文档', () => {
  const original = doc()
  replaceTree(original, [])
  assert.equal(original.contents.size, 3)
})

test('setContent：修改正文返回新文档，原文档不变', () => {
  const original = doc()
  const result = setContent(original, 'a1', '国内研究现状')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.document.contents.get('a1'), '国内研究现状')
  assert.equal(original.contents.get('a1'), '')
})

test('setContent：内容相同返回同一对象', () => {
  const original = doc()
  const result = setContent(original, 'a', '引言')
  assert.equal(result.ok && result.document, original)
})

test('setContent：章节不存在', () => {
  assert.deepEqual(setContent(doc(), 'ghost', 'x'), { ok: false, reason: 'chapter-not-found' })
})

test('setTitle：相同标题返回同一对象', () => {
  const original = doc()
  assert.equal(setTitle(original, '论文'), original)
  assert.equal(setTitle(original, '新标题').title, '新标题')
})

test('setDocumentInfo：新文档没有副标题与作者；相同信息返回同一对象，其余内容不变', () => {
  const original = doc()
  assert.equal(original.subtitle, '')
  assert.equal(original.author, '')
  assert.equal(setDocumentInfo(original, { title: '论文', subtitle: '', author: '' }), original)
  const changed = setDocumentInfo(original, { title: '论文', subtitle: '一项研究', author: '张三' })
  assert.notEqual(changed, original)
  assert.equal(changed.subtitle, '一项研究')
  assert.equal(changed.author, '张三')
  assert.equal(changed.tree, original.tree)
  assert.equal(changed.contents, original.contents)
  assert.equal(original.subtitle, '')
})

test('hasContent：只含空白字符不算有正文', () => {
  const document = doc()
  assert.equal(hasContent(document, 'a'), true)
  assert.equal(hasContent(document, 'a1'), false)
  const whitespace = setContent(document, 'b', '  \n\t')
  assert.equal(whitespace.ok && hasContent(whitespace.document, 'b'), false)
  assert.equal(hasContent(document, 'ghost'), false)
})
