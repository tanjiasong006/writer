import { beforeEach, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createTauriDocumentOutput } from './tauri_document_output.ts'
import type { RenderRequest } from '../application/document_output.ts'
import { resolvePdfLayout } from '../domain/pdf_layout/pdf_layout.ts'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const invokeMock = vi.mocked(invoke)
const request: RenderRequest = {
  title: '论文',
  subtitle: '',
  author: '',
  chapters: [{ id: 'a', number: [1], title: '绪论', markdown: '正文' }],
  references: [],
}

const layout = resolvePdfLayout({ toc: false })

beforeEach(() => {
  invokeMock.mockReset()
})

test('按格式调用对应命令，并解析导出报告', async () => {
  invokeMock.mockResolvedValue({ missingImages: ['../assets/a.png', 3], brokenReferences: ['原目标'] })
  const output = createTauriDocumentOutput()
  expect(await output.exportDocument('/p', request, 'docx', '/out/论文.docx', layout)).toEqual({
    ok: true,
    value: { missingImages: ['../assets/a.png'], brokenReferences: ['原目标'] },
  })
  expect(invokeMock).toHaveBeenCalledWith('export_docx', { path: '/p', document: request, target: '/out/论文.docx' })

  await output.exportDocument('/p', request, 'pdf', '/out/论文.pdf', layout)
  // 只有 PDF 携带排版配置。
  expect(invokeMock).toHaveBeenLastCalledWith('export_pdf', {
    path: '/p',
    document: request,
    target: '/out/论文.pdf',
    layout,
  })
})

test('Rust 返回的结构化错误原样传递，未知错误归为 unknown', async () => {
  invokeMock.mockRejectedValue({ code: 'io', message: '只读文件系统' })
  const output = createTauriDocumentOutput()
  expect(await output.exportDocument('/p', request, 'docx', '/x.docx', layout)).toEqual({
    ok: false,
    error: { code: 'io', message: '只读文件系统' },
  })
  invokeMock.mockImplementation(async () => {
    throw new Error('boom')
  })
  expect(await output.exportDocument('/p', request, 'pdf', '/x.pdf', layout)).toEqual({
    ok: false,
    error: { code: 'unknown', message: 'boom' },
  })
})

test('PDF 样张：携带排版配置，返回各页 SVG', async () => {
  invokeMock.mockResolvedValue(['<svg/>', 1, '<svg/>'])
  const output = createTauriDocumentOutput()
  expect(await output.previewPdf('/p', request, layout)).toEqual({ ok: true, value: ['<svg/>', '<svg/>'] })
  expect(invokeMock).toHaveBeenCalledWith('preview_pdf', { path: '/p', document: request, layout })

  invokeMock.mockRejectedValue({ code: 'no-cjk-font' })
  expect(await output.previewPdf('/p', request, layout)).toEqual({ ok: false, error: { code: 'no-cjk-font' } })
})
