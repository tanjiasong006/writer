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

/**
 * 结束一个会话（切换项目或关闭窗口前）：先尽力保存；保存失败时必须由用户决定是否丢弃，
 * 绝不静默丢弃未保存的修改（docs/decisions.md 第 4 节）。
 *
 * 返回 true 表示会话已释放、可以继续；false 表示用户选择留下，会话保持可用。
 */
export async function releaseSession(
  session: ProjectSession,
  confirmDiscard: (error: StorageFailure | null) => Promise<boolean>,
): Promise<boolean> {
  if (!(await session.close())) {
    if (!(await confirmDiscard(session.lastError))) return false
  }
  session.dispose()
  await session.releaseStorage()
  return true
}
