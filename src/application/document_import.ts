import { ProjectSession, type ProjectSessionOptions } from './project_session.ts'
import type { OpenedProject, ProjectStorage, StorageResult } from './project_storage.ts'

export interface ImportWarningDetail {
  readonly code: string
  readonly location: { readonly block: number; readonly row?: number; readonly cell?: number; readonly tableIndex?: number }
  readonly contentType: string
  readonly nearbyText?: string
}

/** 导入成功后目标项目已提交并打开，调用方负责释放会话。warnings 是无损透传的机器码。 */
export interface DocumentImporter {
  importDocx(sourcePath: string, projectPath: string, title: string): Promise<StorageResult<{
    readonly project: OpenedProject
    readonly warnings: readonly string[]
    readonly warningDetails: readonly ImportWarningDetail[]
  }>>
}

/** 将导入结果转为正常的已保存项目会话；不再次打开项目或取得锁。 */
export async function importDocxProject(
  importer: DocumentImporter,
  storage: ProjectStorage,
  sourcePath: string,
  projectPath: string,
  title: string,
  options?: ProjectSessionOptions,
) {
  const result = await importer.importDocx(sourcePath, projectPath, title)
  if (!result.ok) return result
  return {
    ok: true as const,
    session: new ProjectSession(storage, projectPath, result.value.project, options),
    orphanFiles: result.value.project.orphanFiles,
    warnings: result.value.warnings,
    warningDetails: result.value.warningDetails,
  }
}
