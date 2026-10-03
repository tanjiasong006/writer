import { computed, onBeforeUnmount, shallowRef } from 'vue'
import type { ChapterId, ChapterNode, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { restoreRemovedChapter, type RemovedChapter } from '../../application/remove_chapter.ts'

/** 删除提示显示的时间。 */
const NOTICE_DURATION_MS = 8000
/** 最多可以撤销的删除次数。 */
const MAX_HISTORY = 20

interface Entry {
  readonly removed: RemovedChapter
  /** 被删除的章节（含子章节）的正文。 */
  readonly contents: ReadonlyMap<ChapterId, string>
}

/**
 * 撤销删除章节（ui-spec §23）。
 *
 * - 删除前记下章节的位置与整棵子树的正文；提示“已删除“…””带“撤销”。
 * - 撤销（提示中的按钮，或章节树获得焦点时的 ⌘Z /“编辑 → 撤销删除章节”）把最近一次删除的章节连同子章节与正文
 *   放回原来的位置并选中它；之后的其他结构修改与正文修改保留。可以连续撤销多次删除，不提供重做。
 * - 记录只在本次打开期间有效，不持久化；恢复是普通的项目修改，由正常保存提交。
 */
export function useRemovedChapters(options: {
  readonly tree: () => ChapterTree
  readonly contents: () => ReadonlyMap<ChapterId, string>
  /** 用恢复后的树更新文档；restored 是恢复的章节的正文。 */
  readonly apply: (tree: ChapterTree, restored: ReadonlyMap<ChapterId, string>) => void
  /** 恢复后选中章节。 */
  readonly select: (id: ChapterId) => void
}) {
  const history = shallowRef<readonly Entry[]>([])
  const notice = shallowRef<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  const canUndo = computed(() => history.value.length > 0)

  function showNotice(message: string | null): void {
    notice.value = message
    if (timer !== null) clearTimeout(timer)
    timer = message === null ? null : setTimeout(() => (notice.value = null), NOTICE_DURATION_MS)
  }

  /** 删除之前调用：记下章节与正文。 */
  function record(removed: RemovedChapter): void {
    const all = options.contents()
    const contents = new Map<ChapterId, string>()
    const visit = (node: ChapterNode): void => {
      contents.set(node.id, all.get(node.id) ?? '')
      node.children.forEach(visit)
    }
    visit(removed.node)
    history.value = [...history.value, { removed, contents }].slice(-MAX_HISTORY)
    showNotice(`已删除“${removed.node.title || '未命名章节'}”`)
  }

  /** 撤销最近一次删除；没有可撤销的删除时返回 false。 */
  function undo(): boolean {
    const entry = history.value[history.value.length - 1]
    if (!entry) return false
    history.value = history.value.slice(0, -1)
    showNotice(null)
    const result = restoreRemovedChapter(options.tree(), entry.removed)
    if (!result.ok) return false
    options.apply(result.tree, entry.contents)
    options.select(entry.removed.node.id)
    return true
  }

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer)
  })

  return { notice, canUndo, record, undo, dismiss: () => showNotice(null) }
}
