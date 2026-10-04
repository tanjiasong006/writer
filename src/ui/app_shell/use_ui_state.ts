import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import type { DesktopShell } from '../../application/desktop_shell.ts'
import { restoreUiState, serializeUiState } from './ui_state.ts'

const UI_STATE_DELAY_MS = 500

export interface ProjectUiState {
  readonly selectedId: Ref<ChapterId | null>
  readonly collapsedIds: Ref<ReadonlySet<ChapterId>>
  /** 全文字数目标；null 表示没有。 */
  readonly goal: Ref<number | null>
  /** 今天开始时的全文字数。 */
  readonly today: Ref<{ readonly date: string; readonly startWords: number } | null>
  /** 已从磁盘恢复（之前的值是默认值）。 */
  readonly ready: Ref<boolean>
}

/**
 * 项目的界面状态（选中章节、折叠状态）：挂载时从 `.writer/ui-state.json` 恢复，变化后防抖保存，卸载前保存未写出的变化。
 * 恢复完成前不回写，避免用默认值覆盖磁盘上的状态。
 */
export function useUiState(
  shell: Pick<DesktopShell, 'loadUiState' | 'saveUiState'>,
  projectPath: string,
  tree: () => ChapterTree,
): ProjectUiState {
  const selectedId = ref<ChapterId | null>(null)
  const collapsedIds = shallowRef<ReadonlySet<ChapterId>>(new Set())
  const goal = ref<number | null>(null)
  const today = shallowRef<{ readonly date: string; readonly startWords: number } | null>(null)
  const ready = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  onMounted(async () => {
    const restored = restoreUiState(await shell.loadUiState(projectPath), tree())
    selectedId.value = restored.selectedId
    collapsedIds.value = restored.collapsedIds
    goal.value = restored.goal
    today.value = restored.today
    ready.value = true
  })

  function persist(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
    void shell.saveUiState(
      projectPath,
      serializeUiState({
        selectedId: selectedId.value,
        collapsedIds: collapsedIds.value,
        goal: goal.value,
        today: today.value,
      }),
    )
  }

  watch([selectedId, collapsedIds, goal, today], () => {
    if (!ready.value) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(persist, UI_STATE_DELAY_MS)
  })

  onBeforeUnmount(() => {
    if (timer !== null) persist()
  })

  return { selectedId, collapsedIds, goal, today, ready }
}
