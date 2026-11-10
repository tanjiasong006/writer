import { beforeEach, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createTauriDocumentImporter } from './tauri_document_import.ts'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const mock = vi.mocked(invoke)
const project = { manifest: { format: 'writer-project', version: 1, title: '导入', chapters: [], files: {} }, contents: {}, orphanFiles: [] }
beforeEach(() => { mock.mockReset() })

test('导入并校验项目，保留警告和命令参数', async () => {
  const warningDetails = [{ code: 'table_unsupported', location: { block: 3, row: 2, cell: 1, tableIndex: 1 }, contentType: 'table', nearbyText: '附近文字' }]
  mock.mockResolvedValue({ project, warnings: ['table_unsupported', 'future_warning'], warningDetails })
  const result = await createTauriDocumentImporter().importDocx('/源.docx', '/目标', '项目名')
  expect(mock).toHaveBeenCalledWith('project_import_docx', { source: '/源.docx', path: '/目标', title: '项目名' })
  expect(result.ok && result.value.project.document.title).toBe('导入')
  expect(result.ok && result.value.warnings).toEqual(['table_unsupported', 'future_warning'])
  expect(result.ok && result.value.warningDetails).toEqual(warningDetails)
})

test('兼容没有详情及旧格式详情的响应', async () => {
  for (const warningDetails of [undefined, [{ code: 'x', contentType: 'table', location: { block: 1 } }]]) {
    mock.mockResolvedValue({ project, warnings: ['x'], warningDetails })
    const result = await createTauriDocumentImporter().importDocx('a', 'b', '名称')
    expect(result.ok && result.value.warningDetails).toEqual(warningDetails ?? [])
  }
})

test('命令失败不关闭项目并保留错误', async () => {
  mock.mockRejectedValue({ code: 'storage', error: { code: 'target-not-empty' } })
  expect(await createTauriDocumentImporter().importDocx('a', 'b', '名称')).toEqual({ ok: false, error: { code: 'target-not-empty' } })
  expect(mock).toHaveBeenCalledTimes(1)
})

test.each([
  ...[0, -1, 1.5, null, '1', Number.MAX_SAFE_INTEGER + 1].map(tableIndex => ({ project, warnings: [], warningDetails: [{ code: 'x', contentType: 'table', location: { block: 1, tableIndex } }] })),
  ...[null, 1, {}].map(nearbyText => ({ project, warnings: [], warningDetails: [{ code: 'x', contentType: 'table', location: { block: 1 }, nearbyText }] })),
  { project: {}, warnings: [] },
  { project, warnings: [1] },
  ...[null, {}, [{ code: 'x', contentType: 'table', location: { block: 0 } }], [{ code: 'x', contentType: 'table', location: { block: 1, row: 1.5 } }], [{ code: 'x', contentType: 'table', location: { block: 1, cell: null } }], [{ code: 1, contentType: 'table', location: { block: 1 } }]].map(warningDetails => ({ project, warnings: [], warningDetails })),
  { project: { ...project, manifest: { ...project.manifest, chapters: [{ id: 'a', title: '一', children: [] }, { id: 'a', title: '二', children: [] }], files: { a: 'ch_1.md' } }, contents: { a: '' } }, warnings: [] },
  { project: { ...project, manifest: { ...project.manifest, chapters: [{ id: 'a', title: '一', children: [] }], files: { a: 'ch_1.md' } }, contents: {} }, warnings: [] },
  null,
])('响应无效时释放锁 %j', async (raw) => {
  mock.mockResolvedValueOnce(raw).mockRejectedValueOnce(new Error('close failed'))
  const result = await createTauriDocumentImporter().importDocx('a', 'b', '名称')
  expect(result.ok).toBe(false)
  expect(mock).toHaveBeenLastCalledWith('project_close', { path: 'b' })
})
