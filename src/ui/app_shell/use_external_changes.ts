import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { ProjectSession } from '../../application/project_session.ts'
import type { ProjectState } from '../../application/project_storage.ts'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { detectExternalChanges } from '../../application/external_changes.ts'

/** 定期检查的间隔（窗口获得焦点时也检查）。 */
const CHECK_INTERVAL_MS = 15_000

/** 需要用户决定的外部修改。 */
export interface ExternalConflict {
  /** Writer 中也有尚未保存修改的章节。 */
  readonly chapters: readonly ChapterId[]
  /** 章节结构、标题、文档信息、排版配置或参考文献被修改。 */
  readonly structure: boolean
  readonly disk: ProjectState
  readonly texts: ReadonlyMap<ChapterId, string>
}

/**
 * 发现其他程序对已打开项目的修改（known-risks #4）：窗口获得焦点时与每 15 秒读取一次磁盘上的项目。
 *
 * - 只在磁盘上被修改、Writer 中没有修改的章节：直接载入磁盘上的正文，提示载入了几个章节。
 * - 两边都修改了正文，或章节结构等被修改：询问用户保留 Writer 中的版本（之后保存时覆盖磁盘），
 *   还是使用磁盘上的版本（放弃 Writer 中对这些内容的修改）。
 * - 正在保存时不检查（磁盘上的状态正在变化）；读取失败不打扰（下一次再试）。
 */
export function useExternalChanges(options: {
  readonly session: ProjectSession
  /** 章节名称（提示中使用）。 */
  readonly name: (id: ChapterId) => string
}) {
  const notice = shallowRef<string | null>(null)
  const conflict = shallowRef<ExternalConflict | null>(null)
  let checking = false

  async function check(): Promise<void> {
    const { session } = options
    if (checking || session.saving || conflict.value) return
    checking = true
    try {
      const disk = await session.readFromDisk()
      if (!disk.ok || session.saving) return
      const changes = detectExternalChanges(session.saved, { document: session.document, pdfLayout: session.pdfLayout }, disk.value)
      const quiet = changes.chapters.filter((chapter) => !chapter.edited)
      const edited = changes.chapters.filter((chapter) => chapter.edited)
      if (quiet.length > 0 && !changes.structure) {
        session.adoptDiskContents(new Map(quiet.map((chapter) => [chapter.id, chapter.disk])), new Set(quiet.map((chapter) => chapter.id)))
        notice.value =
          quiet.length === 1
            ? `已载入在其他程序中修改的“${options.name(quiet[0].id)}”。`
            : `已载入在其他程序中修改的 ${quiet.length} 个章节。`
      }
      if (edited.length > 0 || changes.structure) {
        conflict.value = {
          chapters: edited.map((chapter) => chapter.id),
          structure: changes.structure,
          disk: disk.value,
          texts: new Map(changes.chapters.map((chapter) => [chapter.id, chapter.disk])),
        }
      }
    } finally {
      checking = false
    }
  }

  /** 保留 Writer 中的版本：以磁盘上的正文为已保存的内容，Writer 中的内容在下次保存时覆盖磁盘。 */
  function keepWriter(): void {
    const current = conflict.value
    conflict.value = null
    if (!current) return
    options.session.adoptDiskContents(current.texts, new Set())
    options.session.markChanged()
  }

  /** 使用磁盘上的版本：有结构变化时整个文档换成磁盘上的状态，否则只换冲突的章节。 */
  function useDisk(): void {
    const current = conflict.value
    conflict.value = null
    if (!current) return
    if (current.structure) options.session.resetToDisk(current.disk)
    else options.session.adoptDiskContents(current.texts, new Set(current.texts.keys()))
  }

  const onFocus = () => void check()
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    window.addEventListener('focus', onFocus)
    timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void check()
    }, CHECK_INTERVAL_MS)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('focus', onFocus)
    if (timer !== null) clearInterval(timer)
  })

  return { notice, conflict, check, keepWriter, useDisk, dismiss: () => (notice.value = null) }
}
