import type { ChapterId } from '../domain/chapter_tree/chapter_tree.ts'
import type { ProjectState } from './project_storage.ts'

/**
 * 其他程序对已打开项目的修改（known-risks #4）：磁盘上的状态与最近一次确认与磁盘一致的状态比较。
 *
 * - chapters：正文在磁盘上被修改的章节；edited 表示 Writer 中也有尚未保存的修改（冲突）。
 * - structure：manifest 中的内容（章节结构、标题、文档信息、排版配置、参考文献）被修改。
 * 章节结构变化时正文的比较只针对两边都存在的章节。
 */
export interface ExternalChanges {
  readonly chapters: ReadonlyArray<{
    readonly id: ChapterId
    readonly disk: string
    readonly edited: boolean
  }>
  readonly structure: boolean
}

export function detectExternalChanges(saved: ProjectState, current: ProjectState, disk: ProjectState): ExternalChanges {
  const chapters: Array<{ id: ChapterId; disk: string; edited: boolean }> = []
  for (const [id, text] of disk.document.contents) {
    const before = saved.document.contents.get(id)
    if (before === undefined || before === text) continue
    const local = current.document.contents.get(id)
    if (local === undefined) continue
    chapters.push({ id, disk: text, edited: local !== before })
  }
  const a = saved.document
  const b = disk.document
  const structure =
    JSON.stringify(a.tree) !== JSON.stringify(b.tree) ||
    a.title !== b.title ||
    a.subtitle !== b.subtitle ||
    a.author !== b.author ||
    JSON.stringify(a.references) !== JSON.stringify(b.references) ||
    JSON.stringify(saved.pdfLayout) !== JSON.stringify(disk.pdfLayout)
  return { chapters, structure }
}

export function hasExternalChanges(changes: ExternalChanges): boolean {
  return changes.structure || changes.chapters.length > 0
}
