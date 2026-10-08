import { expect, test } from 'vitest'
import { createDocument, setDocumentInfo, setReferences } from '../domain/document/document.ts'
import { emptyReference } from '../domain/bibliography/bibliography.ts'
import {
  buildPdfSample,
  buildRenderRequest,
  createPdfPreview,
  exportDocument,
  type RenderRequest,
  type StructureDrawer,
} from './document_output.ts'
import { MemoryDocumentOutput } from '../testing/memory_document_output.ts'

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
  const document = setDocumentInfo(result.document, { title: '论文', subtitle: '一项研究', author: '张三' })
  expect(buildRenderRequest(document)).toEqual({
    title: '论文',
    subtitle: '一项研究',
    author: '张三',
    chapters: [
      { id: 'a', number: [1], title: '绪论', markdown: 'A' },
      { id: 'a1', number: [1, 1], title: '背景', markdown: 'A1\r\n' },
      { id: 'b', number: [2], title: '方法', markdown: '' },
    ],
    references: [],
    structures: [],
  })
})

test('buildRenderRequest：参考文献按著录格式生成文字', () => {
  const result = createDocument('论文', [], new Map())
  if (!result.ok) throw new Error('fixture')
  const entry = { ...emptyReference('r1', 'article'), author: '王五', title: '题名', container: '刊', year: '2021' }
  expect(buildRenderRequest(setReferences(result.document, [entry])).references).toEqual([
    { id: 'r1', text: '王五. 题名[J]. 刊, 2021.' },
  ])
})

test('buildRenderRequest：只携带内容与结构，不携带任何排版参数', () => {
  const result = createDocument('论文', [{ id: 'a', title: '绪论', children: [] }], new Map([['a', '![图](../assets/图.png)']]))
  if (!result.ok) throw new Error('fixture')
  const request = buildRenderRequest(result.document)
  expect(Object.keys(request).sort()).toEqual(['author', 'chapters', 'references', 'structures', 'subtitle', 'title'])
  expect(Object.keys(request.chapters[0]).sort()).toEqual(['id', 'markdown', 'number', 'title'])
  expect(request.chapters[0].markdown).toBe('![图](../assets/图.png)')
})

test('buildRenderRequest：空文档', () => {
  const result = createDocument('空', [], new Map())
  if (!result.ok) throw new Error('fixture')
  expect(buildRenderRequest(result.document)).toEqual({ title: '空', subtitle: '', author: '', chapters: [], references: [], structures: [] })
})

const sampleRequest = (chapters: [string, number[], string][]): RenderRequest => ({
  title: '论文',
  subtitle: '',
  author: '',
  chapters: chapters.map(([id, number, markdown]) => ({ id, number, title: id, markdown })),
  references: [],
  structures: [],
})

/** 测试用的结构式画法：记录收到的正文，每个正文画出一张图。 */
function recordingDrawer(): { draw: StructureDrawer; calls: Array<readonly string[]> } {
  const calls: Array<readonly string[]> = []
  const draw: StructureDrawer = async (markdowns) => {
    calls.push(markdowns)
    return markdowns.filter((markdown) => markdown !== '').map((markdown) => ({ smiles: markdown, arrow: '', above: '', below: '', rotate: 0, flip: false, png: 'AA==', width: 10, height: 5 }))
  }
  return { draw, calls }
}

test('buildPdfSample：取前两个一级章节及其子章节', () => {
  const sample = buildPdfSample(
    sampleRequest([
      ['a', [1], 'A'],
      ['a1', [1, 1], 'A1'],
      ['b', [2], 'B'],
      ['b1', [2, 1], 'B1'],
      ['c', [3], 'C'],
      ['c1', [3, 1], 'C1'],
    ]),
  )
  expect(sample.title).toBe('论文')
  expect(sample.chapters.map((c) => c.id)).toEqual(['a', 'a1', 'b', 'b1'])
})

test('buildPdfSample：正文总长有上限，在段落边界截断，超出后不再取章节', () => {
  const paragraph = '字'.repeat(5000)
  const sample = buildPdfSample(
    sampleRequest([
      ['a', [1], [paragraph, paragraph, paragraph].join('\n\n')],
      ['a1', [1, 1], '小节'],
    ]),
  )
  expect(sample.chapters).toHaveLength(1)
  expect(sample.chapters[0].markdown).toBe([paragraph, paragraph].join('\n\n'))

  const unbroken = buildPdfSample(sampleRequest([['a', [1], '字'.repeat(20000)]]))
  expect(unbroken.chapters[0].markdown).toHaveLength(12000)
})

test('createPdfPreview：内容只捕获一次，每次按完整的排版配置生成样张', async () => {
  const result = createDocument('论文', [{ id: 'a', title: '绪论', children: [] }], new Map([['a', '正文']]))
  if (!result.ok) throw new Error('fixture')
  const output = new MemoryDocumentOutput()
  const drawer = recordingDrawer()
  const preview = createPdfPreview(output, '/p', result.document, drawer.draw)
  expect(await preview({ paper: 'b5' })).toEqual({ ok: true, value: ['<svg data-paper="b5"></svg>'] })
  await preview({})
  expect(output.previews[0].request).toBe(output.previews[1].request)
  // 结构式的图片只画一次。
  expect(drawer.calls).toEqual([['正文']])
  expect(output.previews[0].request.structures).toEqual([{ smiles: '正文', arrow: '', above: '', below: '', rotate: 0, flip: false, png: 'AA==', width: 10, height: 5 }])
  expect(output.previews[0].request.chapters).toEqual([{ id: 'a', number: [1], title: '绪论', markdown: '正文' }])
  expect(output.previews[1].pdfLayout.paper).toBe('a4')
})

test('exportDocument：请求中带上画好的结构式图片；合并的 Markdown 保留原文，不画图片', async () => {
  const result = createDocument('论文', [{ id: 'a', title: '绪论', children: [] }], new Map([['a', '```smiles\nCCO\n```']]))
  if (!result.ok) throw new Error('fixture')
  const output = new MemoryDocumentOutput()
  const drawer = recordingDrawer()
  await exportDocument(output, '/p', result.document, {}, 'pdf', '/out.pdf', drawer.draw)
  expect(drawer.calls).toEqual([['```smiles\nCCO\n```']])
  expect(output.exports[0].request.structures).toHaveLength(1)

  await exportDocument(output, '/p', result.document, {}, 'markdown', '/out.md', drawer.draw)
  expect(drawer.calls).toHaveLength(1)
  expect(output.exports[1].request.structures).toEqual([])
})
