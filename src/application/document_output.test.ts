import { expect, test } from 'vitest'
import { createDocument } from '../domain/document/document.ts'
import { buildRenderRequest } from './document_output.ts'

test('buildRenderRequest：按阅读顺序展开，编号来自结构，正文原样', () => {
  const result = createDocument(
    '论文',
    [
      { id: 'a', title: '绪论', children: [{ id: 'a1', title: '背景', children: [] }] },
      { id: 'b', title: '方法', children: [] },
    ],
    new Map([
      ['a', 'A'],
      ['a1', 'A1\r\n'],
      ['b', ''],
    ]),
  )
  if (!result.ok) throw new Error('fixture')
  expect(buildRenderRequest(result.document)).toEqual({
    title: '论文',
    chapters: [
      { id: 'a', number: [1], title: '绪论', markdown: 'A' },
      { id: 'a1', number: [1, 1], title: '背景', markdown: 'A1\r\n' },
      { id: 'b', number: [2], title: '方法', markdown: '' },
    ],
  })
})

test('buildRenderRequest：只携带内容与结构，不携带任何排版参数', () => {
  const result = createDocument('论文', [{ id: 'a', title: '绪论', children: [] }], new Map([['a', '![图](../assets/图.png)']]))
  if (!result.ok) throw new Error('fixture')
  const request = buildRenderRequest(result.document)
  expect(Object.keys(request).sort()).toEqual(['chapters', 'title'])
  expect(Object.keys(request.chapters[0]).sort()).toEqual(['id', 'markdown', 'number', 'title'])
  expect(request.chapters[0].markdown).toBe('![图](../assets/图.png)')
})

test('buildRenderRequest：空文档', () => {
  const result = createDocument('空', [], new Map())
  if (!result.ok) throw new Error('fixture')
  expect(buildRenderRequest(result.document)).toEqual({ title: '空', chapters: [] })
})
