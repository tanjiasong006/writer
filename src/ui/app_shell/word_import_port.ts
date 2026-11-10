import type { InjectionKey } from 'vue'
import type { ImportWarningDetail } from '../../application/document_import.ts'
import type { OpenSessionResult } from '../../application/project_lifecycle.ts'

export type WordImportResult =
  | (Extract<OpenSessionResult, { ok: true }> & { readonly warnings: readonly string[]; readonly warningDetails: readonly ImportWarningDetail[] })
  | Extract<OpenSessionResult, { ok: false }>

/** UI 所需的导入能力；失败时目标目录可能保留部分结果。 */
export interface WordImportPort {
  pickFile(): Promise<string | null>
  pickDirectory(): Promise<string | null>
  importProject(request: { filePath: string; projectName: string; targetDirectory: string }): Promise<WordImportResult>
}

export const WORD_IMPORT: InjectionKey<WordImportPort> = Symbol('WordImport')
