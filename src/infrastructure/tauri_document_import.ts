import { invoke } from '@tauri-apps/api/core'
import type { DocumentImporter, ImportWarningDetail } from '../application/document_import.ts'
import { decodeOpened, toFailure } from './tauri_project_storage.ts'

function isWarningDetail(value: unknown): value is ImportWarningDetail {
  if (typeof value !== 'object' || value === null) return false
  const detail = value as Record<string, unknown>
  if (typeof detail.code !== 'string' || typeof detail.contentType !== 'string' || typeof detail.location !== 'object' || detail.location === null) return false
  const location = detail.location as Record<string, unknown>
  const positive = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0
  return positive(location.block) && (location.row === undefined || positive(location.row)) && (location.cell === undefined || positive(location.cell))
    && (location.tableIndex === undefined || positive(location.tableIndex)) && (detail.nearbyText === undefined || typeof detail.nearbyText === 'string')
}

/** command 成功后持有目标项目锁；任意响应校验失败时释放锁。 */
export function createTauriDocumentImporter(): DocumentImporter {
  return {
    async importDocx(sourcePath, projectPath, title) {
      let raw: unknown
      try {
        raw = await invoke<unknown>('project_import_docx', { source: sourcePath, path: projectPath, title })
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error) {
          if (error.code === 'storage' && 'error' in error) return { ok: false, error: toFailure(error.error) }
          if (error.code === 'invalid-docx') return { ok: false, error: { code: 'unknown', message: 'Word 文件无效或无法读取。' } }
        }
        return { ok: false, error: toFailure(error) }
      }
      const response = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : null
      const project = decodeOpened(response?.project)
      const warningsValid = Array.isArray(response?.warnings) && response.warnings.every((w: unknown) => typeof w === 'string')
      const detailsValid = response?.warningDetails === undefined || (Array.isArray(response.warningDetails) && response.warningDetails.every(isWarningDetail))
      if (project.ok && warningsValid && detailsValid) {
        return { ok: true, value: { project: project.value, warnings: response!.warnings as string[], warningDetails: (response!.warningDetails ?? []) as ImportWarningDetail[] } }
      }
      try {
        await invoke('project_close', { path: projectPath })
      } catch {
        // 与普通打开一致：保留原始校验错误，进程退出时释放锁。
      }
      return project.ok
        ? { ok: false, error: { code: 'manifest-invalid', detail: warningsValid ? 'warningDetails' : 'warnings' } }
        : project
    },
  }
}
