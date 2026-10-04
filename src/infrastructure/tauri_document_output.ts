import { invoke } from '@tauri-apps/api/core'
import type {
  DocumentOutput,
  OutputFailure,
  OutputResult,
} from '../application/document_output.ts'

/** DocumentOutput 的 Tauri 实现：渲染与导出在 Rust `render` 模块中完成。 */
export function createTauriDocumentOutput(): DocumentOutput {
  return {
    async exportDocument(projectPath, request, format, targetPath, pdfLayout) {
      const args = { path: projectPath, document: request, target: targetPath }
      const result = await call(() =>
        format === 'pdf' ? invoke<unknown>('export_pdf', { ...args, layout: pdfLayout }) : invoke<unknown>(`export_${format}`, args),
      )
      if (!result.ok) return result
      const raw = result.value as { missingImages?: unknown; brokenReferences?: unknown; invalidFormulas?: unknown } | null
      return {
        ok: true,
        value: {
          missingImages: strings(raw?.missingImages),
          brokenReferences: strings(raw?.brokenReferences),
          invalidFormulas: strings(raw?.invalidFormulas),
        },
      }
    },
    async previewPdf(projectPath, request, pdfLayout) {
      const result = await call(() =>
        invoke<unknown>('preview_pdf', { path: projectPath, document: request, layout: pdfLayout }),
      )
      if (!result.ok) return result
      const pages = Array.isArray(result.value)
        ? result.value.filter((page): page is string => typeof page === 'string')
        : []
      return { ok: true, value: pages }
    },
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function call<T>(run: () => Promise<T>): Promise<OutputResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error: toOutputFailure(error) }
  }
}

const KNOWN_CODES = new Set<OutputFailure['code']>(['no-cjk-font', 'io', 'render-failed'])

export function toOutputFailure(error: unknown): OutputFailure {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string' && KNOWN_CODES.has(code as OutputFailure['code'])) {
      return error as OutputFailure
    }
  }
  return { code: 'unknown', message: error instanceof Error ? error.message : String(error) }
}
