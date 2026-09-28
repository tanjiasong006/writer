import { beforeEach, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createDocument } from '../domain/document/document.ts'
import { createTauriProjectStorage, decodeOpened, toFailure } from './tauri_project_storage.ts'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const invokeMock = vi.mocked(invoke)

const document = (() => {
  const result = createDocument(
    '论文',
    [
      { id: 'a', title: '绪论', children: [] },
      { id: 'b', title: '方法', children: [{ id: 'b1', title: '设计', children: [] }] },
    ],
    new Map([
      ['a', 'A'],
      ['b', 'B'],
      ['b1', 'B1'],
    ]),
  )
  if (!result.ok) throw new Error('fixture')
  return result.document
})()

const manifest = {
  format: 'writer-project',
  version: 1,
  title: '论文',
  chapters: document.tree,
  files: { a: 'ch_1.md', b: 'ch_2.md', b1: 'ch_2_1.md' },
}

beforeEach(() => {
  invokeMock.mockReset()
})

test('save：发送按编号推导的 manifest，只携带变化章节的正文', async () => {
  invokeMock.mockResolvedValue(null)
  const result = await createTauriProjectStorage().save('/p/论文', document, new Set(['b1']))
  expect(result).toEqual({ ok: true, value: undefined })
  expect(invokeMock).toHaveBeenCalledWith('project_save', {
    path: '/p/论文',
    request: { manifest, contents: { b1: 'B1' } },
  })
})

test('create：携带全部正文', async () => {
  invokeMock.mockResolvedValue(null)
  await createTauriProjectStorage().create('/p/新', document)
  expect(invokeMock).toHaveBeenCalledWith('project_create', {
    path: '/p/新',
    request: { manifest, contents: { a: 'A', b: 'B', b1: 'B1' } },
  })
})

test('open：校验后组装文档', async () => {
  invokeMock.mockResolvedValue({
    manifest,
    contents: { a: 'A', b: 'B', b1: 'B1' },
    orphanFiles: ['ch_9.md'],
  })
  const result = await createTauriProjectStorage().open('/p/论文')
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.document.tree).toEqual(document.tree)
  expect(result.value.document.contents.get('b1')).toBe('B1')
  expect(result.value.orphanFiles).toEqual(['ch_9.md'])
})

test('Rust 返回的结构化错误原样传递', async () => {
  invokeMock.mockRejectedValue({ code: 'content-missing', chapterId: 'b', file: 'ch_2.md' })
  expect(await createTauriProjectStorage().open('/p')).toEqual({
    ok: false,
    error: { code: 'content-missing', chapterId: 'b', file: 'ch_2.md' },
  })
})

test('未知错误归为 unknown，不会被当成成功', async () => {
  invokeMock.mockRejectedValue('command project_save not found')
  const result = await createTauriProjectStorage().save('/p', document, new Set())
  expect(result).toEqual({
    ok: false,
    error: { code: 'unknown', message: 'command project_save not found' },
  })
  expect(toFailure({ code: 'made-up' })).toEqual({ code: 'unknown', message: '[object Object]' })
  expect(toFailure(new Error('boom'))).toEqual({ code: 'unknown', message: 'boom' })
})

test('decodeOpened：manifest 或正文不一致时拒绝', () => {
  expect(decodeOpened(null)).toEqual({ ok: false, error: { code: 'manifest-invalid', detail: 'response' } })
  expect(decodeOpened({ manifest: { ...manifest, version: 9 }, contents: {} })).toEqual({
    ok: false,
    error: { code: 'manifest-invalid', detail: 'version-unsupported' },
  })
  expect(decodeOpened({ manifest, contents: { a: 'A', b: 'B' } })).toEqual({
    ok: false,
    error: { code: 'manifest-invalid', detail: 'content-missing' },
  })
  expect(decodeOpened({ manifest, contents: { a: 'A', b: 'B', b1: 3 } })).toEqual({
    ok: false,
    error: { code: 'manifest-invalid', detail: 'contents' },
  })
})
