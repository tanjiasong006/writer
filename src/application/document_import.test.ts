import { expect, test, vi } from 'vitest'
import { emptyDocument } from '../domain/document/document.ts'
import { MemoryProjectStorage } from '../testing/memory_project_storage.ts'
import { importDocxProject, type DocumentImporter } from './document_import.ts'

test('导入成功直接建立已保存会话，透传警告，释放时关闭项目', async () => {
  const storage = new MemoryProjectStorage()
  const open = vi.spyOn(storage, 'open')
  const importer: DocumentImporter = { importDocx: vi.fn().mockResolvedValue({ ok: true, value: {
    project: { document: emptyDocument('导入'), pdfLayout: {}, orphanFiles: ['extra.md'] }, warnings: ['table_unsupported'], warningDetails: [{ code: 'table_unsupported', location: { block: 1 }, contentType: 'table' }],
  } }) }
  const result = await importDocxProject(importer, storage, 'source', 'target', '项目名', { autosaveDelayMs: null })
  expect(importer.importDocx).toHaveBeenCalledWith('source', 'target', '项目名')
  expect(open).not.toHaveBeenCalled()
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.session.path).toBe('target')
  expect(result.session.status).toBe('saved')
  expect(result.orphanFiles).toEqual(['extra.md'])
  expect(result.warnings).toEqual(['table_unsupported'])
  expect(result.warningDetails).toEqual([{ code: 'table_unsupported', location: { block: 1 }, contentType: 'table' }])
  await result.session.releaseStorage()
  expect(storage.closed).toEqual(['target'])
})

test('导入失败原样返回', async () => {
  const importer: DocumentImporter = { importDocx: async () => ({ ok: false, error: { code: 'target-not-empty' } }) }
  expect(await importDocxProject(importer, new MemoryProjectStorage(), 's', 'p', '名称')).toEqual({ ok: false, error: { code: 'target-not-empty' } })
})
