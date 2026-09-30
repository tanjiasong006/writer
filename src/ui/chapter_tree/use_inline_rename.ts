import { nextTick, ref, watch } from 'vue'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'

/**
 * 章节标题的内联重命名：由 editingId 驱动，进入时以当前标题初始化草稿并聚焦、全选输入框。
 * Enter / 失焦提交，空标题视为放弃；Esc 放弃。每次编辑只提交或放弃一次（Esc 导致卸载后的 blur 不再提交）。
 */
export function useInlineRename(options: {
  readonly editingId: () => ChapterId | null | undefined
  readonly titleOf: (chapterId: ChapterId) => string
  readonly onRename: (chapterId: ChapterId, title: string) => void
  readonly onCancel: () => void
  /** 用键盘结束后焦点回到该章节所在行。 */
  readonly focusRow: (chapterId: ChapterId) => void
}) {
  const draft = ref('')
  const input = ref<HTMLInputElement | null>(null)
  let done = false

  /** 输入框的函数 ref（输入框在 v-for 中）。 */
  function setInput(element: unknown): void {
    input.value = element instanceof HTMLInputElement ? element : null
  }

  watch(
    options.editingId,
    async (id) => {
      done = false
      if (id === null || id === undefined) {
        draft.value = ''
        return
      }
      draft.value = options.titleOf(id)
      await nextTick()
      input.value?.focus()
      input.value?.select()
    },
    { immediate: true },
  )

  function commit(): void {
    const id = options.editingId()
    if (id === null || id === undefined || done) return
    done = true
    const title = draft.value.trim()
    if (title.length === 0) options.onCancel()
    else options.onRename(id, title)
  }

  function cancel(): void {
    if (done) return
    done = true
    options.onCancel()
  }

  /**
   * 用键盘结束重命名（Enter 确认 / Esc 放弃）：输入框随之消失，焦点回到该章节所在行，不会掉到页面上。
   * 新建的章节与已有章节相同：确认标题后留在章节树，可以继续调整结构，再用 Enter 或 ⌘J 进入正文。
   * 失焦提交时焦点已经在别处，不再移动。
   */
  function finishByKey(submit: boolean): void {
    const id = options.editingId()
    if (id === null || id === undefined || done) return
    if (submit) commit()
    else cancel()
    options.focusRow(id)
  }

  return { draft, setInput, commit, finishByKey }
}
