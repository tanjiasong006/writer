import { expect, test } from 'vitest'
import { createDocument, setContent, setTitle } from '../domain/document/document.ts'
import { detectExternalChanges, hasExternalChanges } from './external_changes.ts'

const base = (() => {
  const result = createDocument('论文', [{ id: 'a', title: '一', children: [] }, { id: 'b', title: '二', children: [] }], new Map([['a', 'A'], ['b', 'B']]))
  if (!result.ok) throw new Error('fixture')
  return result.document
})()

function edit(id: string, text: string, document = base) {
  const result = setContent(document, id, text)
  if (!result.ok) throw new Error('fixture')
  return result.document
}

test('磁盘上修改的章节；Writer 中也修改过的是冲突', () => {
  const saved = { document: base, pdfLayout: {} }
  const current = { document: edit('b', 'B 本地'), pdfLayout: {} }
  const disk = { document: edit('b', 'B 外部', edit('a', 'A 外部')), pdfLayout: {} }
  expect(detectExternalChanges(saved, current, disk)).toEqual({
    chapters: [
      { id: 'a', disk: 'A 外部', edited: false },
      { id: 'b', disk: 'B 外部', edited: true },
    ],
    structure: false,
  })
})

test('没有修改；标题或排版配置被修改是结构变化', () => {
  const saved = { document: base, pdfLayout: {} }
  expect(hasExternalChanges(detectExternalChanges(saved, saved, { document: base, pdfLayout: {} }))).toBe(false)
  expect(detectExternalChanges(saved, saved, { document: setTitle(base, '新'), pdfLayout: {} }).structure).toBe(true)
  expect(detectExternalChanges(saved, saved, { document: base, pdfLayout: { toc: false } }).structure).toBe(true)
})
