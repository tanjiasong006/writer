import type { ChapterNode, ChapterTree } from '../domain/chapter_tree/chapter_tree.ts'
import { emptyDocument, replaceTree } from '../domain/document/document.ts'
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
    session: new ProjectSession(storage, path, result.value, options),
    orphanFiles: result.value.orphanFiles,
  }
}

/**
 * 新建文档时预先建好的一个章节（文档模板，docs/decisions.md 第 19 节）：标题、写作提示与子章节。
 * 写作提示放在章节备注中，不写进正文，用户不需要删除它们才能开始写。
 */
export interface OutlineChapter {
  readonly title: string
  readonly note?: string
  readonly children?: readonly OutlineChapter[]
}

/** 由模板大纲生成章节树（每个章节新的 id，空正文由 replaceTree 补齐）。 */
export function outlineTree(outline: readonly OutlineChapter[]): ChapterTree {
  return outline.map((chapter): ChapterNode => ({
    id: crypto.randomUUID(),
    title: chapter.title,
    ...(chapter.note === undefined ? {} : { note: chapter.note }),
    children: outlineTree(chapter.children ?? []),
  }))
}

/**
 * 在 path 新建一个文档项目。没有模板大纲时是空文档（没有章节，ui-spec §26 的空状态引导用户新建第一个章节），
 * 有大纲时预先建好其中的章节（正文为空）。只有磁盘创建成功才返回会话。
 */
export async function createProject(
  storage: ProjectStorage,
  path: string,
  title: string,
  options?: ProjectSessionOptions,
  outline: readonly OutlineChapter[] = [],
): Promise<OpenSessionResult> {
  const document = replaceTree(emptyDocument(title), outlineTree(outline))
  const project = { document, pdfLayout: {} }
  const result = await storage.create(path, project)
  if (!result.ok) return result
  return { ok: true, session: new ProjectSession(storage, path, project, options), orphanFiles: [] }
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
