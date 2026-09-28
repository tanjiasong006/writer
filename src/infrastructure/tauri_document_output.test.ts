import { beforeEach, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createTauriDocumentOutput } from './tauri_document_output.ts'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const invokeMock = vi.mocked(invoke)
const request = { title: '论文', chapters: [{ id: 'a', number: [1], title: '绪论', markdown: '正文' }] }

beforeEach(() => {
  invokeMock.mockReset()
})

test('按格式调用对应命令，并解析导出报告', async () => {
  invokeMock.mockResolvedValue({ missingImages: ['../assets/a.png', 3] })
  const output = createTauriDocumentOutput()
  expect(await output.exportDocument('/p', request, 'docx', '/out/论文.docx')).toEqual({
    ok: true,
    value: { missingImages: ['../assets/a.png'] },
  })
  expect(invokeMock).toHaveBeenCalledWith('export_docx', { path: '/p', document: request, target: '/out/论文.docx' })

  await output.exportDocument('/p', request, 'pdf', '/out/论文.pdf')
  expect(invokeMock).toHaveBeenLastCalledWith('export_pdf', { path: '/p', document: request, target: '/out/论文.pdf' })
})

test('Rust 返回的结构化错误原样传递，未知错误归为 unknown', async () => {
  invokeMock.mockRejectedValue({ code: 'io', message: '只读文件系统' })
  const output = createTauriDocumentOutput()
  expect(await output.exportDocument('/p', request, 'docx', '/x.docx')).toEqual({
    ok: false,
    error: { code: 'io', message: '只读文件系统' },
  })
  invokeMock.mockImplementation(async () => {
    throw new Error('boom')
  })
  expect(await output.renderPreview('/p', request)).toEqual({ ok: false, error: { code: 'unknown', message: 'boom' } })
})
