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

test('open：读出副标题与作者；缺省时为空', async () => {
  invokeMock.mockResolvedValue({
    manifest: { ...manifest, subtitle: '一项研究', author: '张三' },
    contents: { a: 'A', b: 'B', b1: 'B1' },
  })
  const result = await createTauriProjectStorage().open('/p/论文')
  expect(result.ok && result.value.document).toMatchObject({ title: '论文', subtitle: '一项研究', author: '张三' })

  invokeMock.mockResolvedValue({ manifest, contents: { a: 'A', b: 'B', b1: 'B1' } })
  const plain = await createTauriProjectStorage().open('/p/论文')
  expect(plain.ok && plain.value.document).toMatchObject({ subtitle: '', author: '' })
})

test('Rust 返回的结构化错误原样传递', async () => {
  invokeMock.mockRejectedValue({ code: 'content-missing', chapterId: 'b', file: 'ch_2.md' })
  expect(await createTauriProjectStorage().open('/p')).toEqual({
    ok: false,
    error: { code: 'content-missing', chapterId: 'b', file: 'ch_2.md' },
  })
  expect(invokeMock).toHaveBeenCalledTimes(1)
})

test('open：前端校验失败时先释放后端项目锁，再返回校验错误', async () => {
  invokeMock.mockResolvedValueOnce({ manifest: { ...manifest, title: 12 }, contents: {} })
  let unlock!: () => void
  invokeMock.mockImplementationOnce(() => new Promise<void>((resolve) => { unlock = resolve }))
  let returned = false
  const opening = createTauriProjectStorage().open('/p/论文').then((result) => {
    returned = true
    return result
  })
  await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('project_close', { path: '/p/论文' }))
  expect(returned).toBe(false)
  unlock()
  expect(await opening).toEqual({ ok: false, error: { code: 'manifest-invalid', detail: 'title-invalid' } })
})

test('open：释放失败仍保留原始校验错误', async () => {
  invokeMock.mockResolvedValueOnce({ manifest, contents: { a: 'A' } })
  invokeMock.mockRejectedValueOnce('IPC failure')
  expect(await createTauriProjectStorage().open('/p')).toEqual({
    ok: false, error: { code: 'manifest-invalid', detail: 'content-missing' },
  })
  expect(invokeMock).toHaveBeenLastCalledWith('project_close', { path: '/p' })
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

test('旧项目的 style（已取消的文档样式）：打开时忽略，正文不受影响；下一次保存不再写出', async () => {
  const opened = decodeOpened({
    manifest: {
      ...manifest,
      style: { theme: 'classic', overrides: { bodySize: 99 }, images: { 'assets/图.png': { size: 'full' } } },
    },
    contents: { a: 'A', b: 'B', b1: 'B1' },
    orphanFiles: [],
  })
  if (!opened.ok) throw new Error('decode')
  expect(Object.keys(opened.value.document).sort()).toEqual(['author', 'contents', 'subtitle', 'title', 'tree'])
  expect(opened.value.document.contents.get('b1')).toBe('B1')

  invokeMock.mockResolvedValue(null)
  await createTauriProjectStorage().save('/p/论文', opened.value.document, new Set())
  const sent = invokeMock.mock.calls[0][1] as { request: { manifest: unknown; contents: unknown } }
  expect(sent.request.contents).toEqual({})
  expect(sent.request.manifest).toEqual(manifest)
})
