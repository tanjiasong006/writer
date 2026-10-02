import { computed, nextTick, onBeforeUnmount, shallowRef, type Ref } from 'vue'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'

/** 跳转提示显示的时间。 */
const NOTICE_DURATION_MS = 6000
/** 最多记住的返回位置。 */
const MAX_HISTORY = 50

/**
 * 从章节引用前往目标章节，以及“返回上一位置”（docs/decisions.md 第 9 节）。
 *
 * - 前往：选中目标章节，光标放在正文开头；记下出发的章节，提示中提供“返回”。
 * - 返回：回到最近一次出发的章节。编辑器为每个章节保留选区与滚动位置，回去后停在原处。
 *   已被删除的章节跳过。
 * - 只记引用跳转，章节树中的点选不进入历史。历史不持久化。
 */
export function useChapterJumps(options: {
  readonly selectedId: Ref<ChapterId | null>
  readonly exists: (id: ChapterId) => boolean
  /** 目标章节完整的名称（编号 + 标题），用于提示。 */
  readonly name: (id: ChapterId) => string
  /** 前往后把光标放在目标章节的开头。 */
  readonly revealStart: (id: ChapterId) => void
  /** 返回后让正文获得焦点。 */
  readonly focus: () => void
}) {
  const history = shallowRef<readonly ChapterId[]>([])
  const notice = shallowRef<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  const canGoBack = computed(() => history.value.some(options.exists))

  function showNotice(message: string | null): void {
    notice.value = message
    if (timer !== null) clearTimeout(timer)
    timer = message === null ? null : setTimeout(() => (notice.value = null), NOTICE_DURATION_MS)
  }

  async function jump(target: ChapterId): Promise<void> {
    const from = options.selectedId.value
    if (!options.exists(target)) return
    if (from !== null && from !== target) history.value = [...history.value, from].slice(-MAX_HISTORY)
    options.selectedId.value = target
    await nextTick()
    options.revealStart(target)
    showNotice(`已前往“${options.name(target)}”`)
  }

  async function back(): Promise<void> {
    const stack = [...history.value]
    let target: ChapterId | undefined
    while ((target = stack.pop()) !== undefined && !options.exists(target));
    history.value = stack
    showNotice(null)
    if (target === undefined) return
    options.selectedId.value = target
    await nextTick()
    options.focus()
  }

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer)
  })

  return { notice, canGoBack, jump, back, dismiss: () => showNotice(null) }
}
