import { expect, test } from 'vitest'
import { createDocument } from '../domain/document/document.ts'
import {
  THEMES,
  defaultDocumentStyle,
  overrideStyle,
  resolveTheme,
  setImageLayout,
} from '../domain/document_style/document_style.ts'
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
    theme: THEMES.book,
    images: {},
  })
})

test('buildRenderRequest：携带解析后的主题与图片布局（正文不含排版信息）', () => {
  let style = overrideStyle(defaultDocumentStyle(), { bodyFont: 'sans', bodySize: 14 })
  style = setImageLayout(style, 'assets/图.png', { size: 'small', align: 'right' })
  const result = createDocument('论文', [{ id: 'a', title: '绪论', children: [] }], new Map([['a', '![图](../assets/图.png)']]), style)
  if (!result.ok) throw new Error('fixture')
  const request = buildRenderRequest(result.document)
  expect(request.theme).toEqual(resolveTheme(style))
  expect(request.theme.body.size).toBe(14)
  expect(request.images).toEqual({ 'assets/图.png': { size: 'small', align: 'right' } })
  expect(request.chapters[0].markdown).toBe('![图](../assets/图.png)')
})

test('buildRenderRequest：空文档', () => {
  const result = createDocument('空', [], new Map())
  if (!result.ok) throw new Error('fixture')
  expect(buildRenderRequest(result.document)).toEqual({ title: '空', chapters: [], theme: THEMES.book, images: {} })
})
