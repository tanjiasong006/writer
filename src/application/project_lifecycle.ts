import { emptyDocument } from '../domain/document/document.ts'
import { ProjectSession, type ProjectSessionOptions } from './project_session.ts'
import type { ProjectStorage, StorageFailure } from './project_storage.ts'

export type OpenSessionResult =
  | { readonly ok: true; readonly session: ProjectSession; readonly orphanFiles: readonly string[] }
  | { readonly ok: false; readonly error: StorageFailure }

/** 打开已有项目，得到编辑会话。 */
export async function openProject(
  storage: ProjectStorage,
  path: string,
  options?: ProjectSessionOptions,
): Promise<OpenSessionResult> {
  const result = await storage.open(path)
  if (!result.ok) return result
  return {
    ok: true,
    session: new ProjectSession(storage, path, result.value.document, options),
    orphanFiles: result.value.orphanFiles,
  }
}

/**
 * 在 path 新建一个空文档项目（没有章节，ui-spec §26 的空状态引导用户新建第一个章节）。
 * 只有磁盘创建成功才返回会话。
 */
export async function createProject(
  storage: ProjectStorage,
  path: string,
  title: string,
  options?: ProjectSessionOptions,
): Promise<OpenSessionResult> {
  const document = emptyDocument(title)
  const result = await storage.create(path, document)
  if (!result.ok) return result
  return { ok: true, session: new ProjectSession(storage, path, document, options), orphanFiles: [] }
}
