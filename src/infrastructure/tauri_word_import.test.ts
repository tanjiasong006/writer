import { beforeEach, expect, it, vi } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import { createTauriWordImport } from './tauri_word_import.ts'
import { MemoryProjectStorage } from '../testing/memory_project_storage.ts'
import type { DocumentImporter } from '../application/document_import.ts'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
})

it('选择 docx 和目标目录并保留取消结果', async () => {
  vi.mocked(open).mockResolvedValueOnce('/报告.docx').mockResolvedValueOnce(null)
  const port = createTauriWordImport({} as DocumentImporter, new MemoryProjectStorage())
  expect(await port.pickFile()).toBe('/报告.docx')
  expect(await port.pickDirectory()).toBeNull()
  expect(open).toHaveBeenNthCalledWith(1, expect.objectContaining({ multiple: false, filters: [{ name: 'Word 文档', extensions: ['docx'] }] }))
  expect(open).toHaveBeenNthCalledWith(2, expect.objectContaining({ directory: true, multiple: false }))
})

it('调用应用用例并传递导入错误', async () => {
  const importDocx = vi.fn<DocumentImporter['importDocx']>().mockResolvedValue({ ok: false, error: { code: 'target-not-empty' } })
  const port = createTauriWordImport({ importDocx }, new MemoryProjectStorage())
  expect(await port.importProject({ filePath: '/报告.docx', targetDirectory: '/目标/', projectName: ' 项目 ' })).toEqual({ ok: false, error: { code: 'target-not-empty' } })
  expect(importDocx).toHaveBeenCalledWith('/报告.docx', '/目标/项目', '项目')
})

it('拒绝危险目录名和非绝对目标路径，不调用导入器', async () => {
  const importDocx = vi.fn<DocumentImporter['importDocx']>()
  const port = createTauriWordImport({ importDocx }, new MemoryProjectStorage())
  for (const projectName of ['', '.', '..', '../escape', 'a\\b', 'C:foo', 'NUL.txt', 'name.']) {
    expect((await port.importProject({ filePath: '/a.docx', targetDirectory: '/目标', projectName })).ok).toBe(false)
  }
  expect((await port.importProject({ filePath: '/a.docx', targetDirectory: 'relative', projectName: '项目' })).ok).toBe(false)
  expect(importDocx).not.toHaveBeenCalled()
})

it('拼接 Windows 根目录与 UNC 路径', async () => {
  vi.stubGlobal('navigator', { platform: 'Win32' })
  const importDocx = vi.fn<DocumentImporter['importDocx']>().mockResolvedValue({ ok: false, error: { code: 'target-not-empty' } })
  const port = createTauriWordImport({ importDocx }, new MemoryProjectStorage())
  await port.importProject({ filePath: 'C:\\a.docx', targetDirectory: 'C:\\', projectName: '项目' })
  await port.importProject({ filePath: 'C:\\a.docx', targetDirectory: '\\\\server\\share\\', projectName: '项目' })
  expect(importDocx).toHaveBeenNthCalledWith(1, 'C:\\a.docx', 'C:\\项目', '项目')
  expect(importDocx).toHaveBeenNthCalledWith(2, 'C:\\a.docx', '\\\\server\\share\\项目', '项目')
})
