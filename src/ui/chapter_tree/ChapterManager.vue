<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ChapterTree from './ChapterTree.vue'
import Toast from '../common/Toast.vue'
import {
  appendChapter,
  createChapterAfter,
  type CreateChapterResult,
} from '../../application/create_chapter.ts'
import {
  keyboardMoveIntent,
  moveChapterTo,
  type KeyboardMoveDirection,
  type MoveIntent,
} from '../../application/move_chapter.ts'
import { renameChapter } from '../../application/rename_chapter.ts'
import { removeChapter, selectionAfterRemove } from '../../application/remove_chapter.ts'
import {
  countDescendants,
  findChapter,
  type ChapterId,
  type ChapterTree as ChapterTreeModel,
  type InsertReason,
  type MoveReason,
  type RemoveReason,
  type RenameReason,
} from '../../domain/chapter_tree/chapter_tree.ts'

/**
 * 章节管理组合组件。
 *
 * 持有章节树、选中态与编辑态，把 ChapterTree 发出的意图交给 Application 用例执行，
 * 失败原因在这里映射成用户文案。章节结构规则不在这一层重写。
 * 新建后会自动选中新章节并进入内联重命名。
 */

/** 新建章节的默认标题；创建后立即进入内联编辑，用户直接输入即可。 */
const DEFAULT_TITLE = '未命名章节'

/**
 * 受控组件：章节树与选中章节由上层持有（v-model:tree / v-model:selected-id），
 * 这里只把意图交给 Application 用例并发出新值。
 */
const tree = defineModel<ChapterTreeModel>('tree', { required: true })
const selectedId = defineModel<ChapterId | null>('selectedId', { default: null })
/** 折叠状态；上层绑定时可随项目保存与恢复，不绑定时是组件内部状态。 */
const collapsedIds = defineModel<ReadonlySet<ChapterId>>('collapsedIds', {
  default: () => new Set<ChapterId>(),
})

const emit = defineEmits<{
  /** 用户在章节树中按 Enter，要求进入该章节的正文。 */
  open: [chapterId: ChapterId]
}>()

const props = defineProps<{
  /** 章节是否有正文：决定删除确认中的说明。不提供时保守地认为都有正文。 */
  hasContent?: (chapterId: ChapterId) => boolean
}>()

const editingId = ref<ChapterId | null>(null)
const deletingId = ref<ChapterId | null>(null)
const errorMessage = ref<string | null>(null)
const confirmCancelButton = ref<HTMLButtonElement | null>(null)
const confirmDialog = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)
const treeView = ref<InstanceType<typeof ChapterTree> | null>(null)

const deleting = computed(() =>
  deletingId.value === null ? null : findChapter(tree.value, deletingId.value),
)
const deletingTitle = computed(() => deleting.value?.title ?? '')
const deletingDescendantCount = computed(() =>
  deletingId.value === null ? 0 : countDescendants(tree.value, deletingId.value),
)
const deletingHasContent = computed(() =>
  deletingId.value === null ? false : chapterHasContent(deletingId.value),
)

function chapterHasContent(chapterId: ChapterId): boolean {
  return props.hasContent ? props.hasContent(chapterId) : true
}

function clearError(): void {
  errorMessage.value = null
}

/**
 * Tree Header 的 +：有选中章节时在其后新建同级，否则追加到根末尾（spec §21）。
 * 位置换算交给 Application，UI 不自己定位父节点或算下标。
 */
function createRoot(): void {
  clearError()
  editingId.value = null
  deletingId.value = null
  const result =
    selectedId.value === null
      ? appendChapter(tree.value, null, DEFAULT_TITLE)
      : createChapterAfter(tree.value, selectedId.value, DEFAULT_TITLE)
  applyCreate(result)
}

function createSibling(chapterId: ChapterId): void {
  clearError()
  editingId.value = null
  deletingId.value = null
  applyCreate(createChapterAfter(tree.value, chapterId, DEFAULT_TITLE))
}

function createChild(chapterId: ChapterId): void {
  clearError()
  editingId.value = null
  deletingId.value = null
  applyCreate(appendChapter(tree.value, chapterId, DEFAULT_TITLE))
}

/** 新建成功后选中新章节并立即进入内联重命名。 */
function applyCreate(result: CreateChapterResult): void {
  if (!result.ok) {
    errorMessage.value = messageForInsert(result.reason)
    return
  }
  tree.value = result.tree
  selectedId.value = result.chapterId
  editingId.value = result.chapterId
  errorMessage.value = null
}

function startRename(chapterId: ChapterId): void {
  clearError()
  deletingId.value = null
  editingId.value = chapterId
}

function commitRename(chapterId: ChapterId, title: string): void {
  editingId.value = null
  const result = renameChapter(tree.value, chapterId, title)
  if (!result.ok) {
    errorMessage.value = messageForRename(result.reason)
    return
  }
  tree.value = result.tree
  errorMessage.value = null
}

function cancelRename(): void {
  editingId.value = null
}

/**
 * 删除章节（节点菜单、右键菜单、菜单栏、⌘⌫ 相同，ui-spec §23）：没有正文也没有子章节时直接删除，
 * 否则先确认，说明按章节内容给出。
 */
function requestDelete(chapterId: ChapterId): void {
  clearError()
  editingId.value = null
  if (countDescendants(tree.value, chapterId) === 0 && !chapterHasContent(chapterId)) {
    deletingId.value = null
    applyDelete(chapterId)
    return
  }
  deletingId.value = chapterId
  void focusConfirmCancel()
}

/** 打开删除确认后把焦点移到取消按钮，键盘用户不迷路。 */
async function focusConfirmCancel(): Promise<void> {
  await nextTick()
  confirmCancelButton.value?.focus()
}

function confirmDelete(): void {
  const id = deletingId.value
  if (id === null) return
  applyDelete(id)
}

function applyDelete(id: ChapterId): void {
  const next = selectionAfterRemove(tree.value, id)
  const result = removeChapter(tree.value, id)
  if (!result.ok) {
    errorMessage.value = messageForRemove(result.reason)
    return
  }
  tree.value = result.tree
  // 选中章节被删除（或在被删章节的子树中）时，改为选中相邻章节，可以直接继续写作。
  // 必须对照 result.tree：受控模式下 tree.value 要等上层更新 props 后才是新树。
  if (selectedId.value !== null && findChapter(result.tree, selectedId.value) === null) {
    selectedId.value = next
  }
  editingId.value = null
  deletingId.value = null
  errorMessage.value = null
  // 焦点留在章节树中：落在删除后选中的章节上，可以继续用键盘操作。
  // 从正文经菜单栏直接删除空章节时焦点不在这里，留在原处，不打断写作。
  const active = document.activeElement
  if (active !== null && active !== document.body && !root.value?.contains(active)) return
  const focusTarget = selectedId.value === id ? next : selectedId.value
  if (focusTarget !== null) void treeView.value?.focusRow(focusTarget)
}

/** 取消删除：焦点回到要删除的那一行。 */
function cancelDelete(): void {
  const id = deletingId.value
  deletingId.value = null
  if (id !== null) void treeView.value?.focusRow(id)
}

/**
 * 删除确认是模态对话框：Esc 取消，Tab 只在两个按钮之间循环。
 * 在 window 的捕获阶段处理，不依赖焦点仍在对话框中：系统菜单（节点菜单、菜单栏）关闭时 WebView 可能把焦点
 * 还给原来的元素，这时按键也不能落到章节树、正文或全局快捷键上；Tab 把焦点带回对话框。
 */
function onConfirmKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancelDelete()
    return
  }
  if (event.key !== 'Tab') return
  event.preventDefault()
  event.stopPropagation()
  const buttons = [...(confirmDialog.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  if (buttons.length === 0) return
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (index === -1) {
    buttons[0].focus()
    return
  }
  const next = event.shiftKey ? index - 1 : index + 1
  buttons[(next + buttons.length) % buttons.length].focus()
}

watch(deletingId, (id, previous) => {
  if (id !== null && previous === null) window.addEventListener('keydown', onConfirmKeydown, true)
  else if (id === null) window.removeEventListener('keydown', onConfirmKeydown, true)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onConfirmKeydown, true))

function select(chapterId: ChapterId): void {
  // 重复点击当前章节不算切换上下文，保留未完成的编辑与删除确认。
  if (chapterId === selectedId.value) return
  selectedId.value = chapterId
  editingId.value = null
  deletingId.value = null
}

function move(intent: MoveIntent): void {
  editingId.value = null
  const result = moveChapterTo(tree.value, intent)
  if (!result.ok) {
    errorMessage.value = messageForMove(result.reason)
    return
  }
  tree.value = result.tree
  errorMessage.value = null
}

/**
 * 菜单栏中的章节命令，作用于当前选中章节（与节点菜单、快捷键相同）。
 * 新建章节没有选中章节时追加到末尾（spec §21）。
 */
defineExpose({
  createChapter: createRoot,
  createChildChapter: () => selectedId.value !== null && createChild(selectedId.value),
  renameChapter: () => selectedId.value !== null && startRename(selectedId.value),
  deleteChapter: () => selectedId.value !== null && requestDelete(selectedId.value),
  moveChapter: (direction: KeyboardMoveDirection) =>
    selectedId.value !== null && treeView.value?.moveChapter(selectedId.value, direction),
  canMove: (direction: KeyboardMoveDirection) =>
    selectedId.value !== null && keyboardMoveIntent(tree.value, selectedId.value, direction) !== null,
  /** 从别处（正文、⌘J）进入章节树；删除确认打开时焦点留在对话框中。 */
  focusCurrent: () => deletingId.value === null && treeView.value?.focusCurrent(),
})

/** Domain 只给机器可读 reason，面向用户的中文文案由 UI 层负责。 */
function messageForInsert(reason: InsertReason): string {
  switch (reason) {
    case 'parent-not-found':
      return '找不到要添加到的父章节。'
    case 'index-out-of-range':
      return '添加位置无效。'
    case 'id-duplicate':
      return '新章节与已有章节重复，请重试。'
    case 'depth-exceeded':
      return '章节层级太深，无法再添加子章节。'
    default:
      return '新章节数据无效。'
  }
}

function messageForRename(reason: RenameReason): string {
  switch (reason) {
    case 'chapter-not-found':
      return '选中的章节不存在，无法重命名。'
    default:
      return '重命名失败。'
  }
}

function messageForRemove(reason: RemoveReason): string {
  switch (reason) {
    case 'chapter-not-found':
      return '选中的章节不存在，无法删除。'
    default:
      return '删除失败。'
  }
}

function messageForMove(reason: MoveReason): string {
  switch (reason) {
    case 'chapter-not-found':
      return '要移动的章节不存在。'
    case 'target-not-found':
      return '目标章节不存在。'
    case 'target-is-descendant':
      return '不能把章节移动到它自己的子章节里。'
    case 'index-out-of-range':
      return '目标位置无效。'
    case 'depth-exceeded':
      return '章节层级太深，无法移动到这里。'
  }
}
</script>

<template>
  <section ref="root" class="chapter-manager">
    <ChapterTree
      ref="treeView"
      v-model:collapsed-ids="collapsedIds"
      :tree="tree"
      :selected-id="selectedId"
      :editing-id="editingId"
      @select="select"
      @move="move"
      @create-root="createRoot"
      @create-sibling="createSibling"
      @create-child="createChild"
      @start-rename="startRename"
      @rename="commitRename"
      @cancel-rename="cancelRename"
      @delete="requestDelete"
      @open="emit('open', $event)"
    />

    <div v-if="errorMessage !== null" class="chapter-manager__notice">
      <Toast class="chapter-manager__error" tone="error" @dismiss="clearError">{{ errorMessage }}</Toast>
    </div>

    <div v-if="deletingId !== null" class="chapter-manager__scrim" @mousedown.self="cancelDelete">
      <div
        ref="confirmDialog"
        class="chapter-manager__confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="chapter-manager-confirm-title"
        aria-describedby="chapter-manager-confirm-text"
      >
        <h2 id="chapter-manager-confirm-title" class="chapter-manager__confirm-title">
          删除「{{ deletingTitle || '选中的章节' }}」？
        </h2>
        <p id="chapter-manager-confirm-text" class="chapter-manager__confirm-text">
          <template v-if="deletingHasContent && deletingDescendantCount > 0">
            该章节包含正文以及 {{ deletingDescendantCount }} 个子章节，删除后会一并移除。
          </template>
          <template v-else-if="deletingDescendantCount > 0">
            该章节包含 {{ deletingDescendantCount }} 个子章节，删除后会一并移除。
          </template>
          <template v-else>该章节包含正文，删除后无法恢复。</template>
        </p>
        <div class="chapter-manager__confirm-actions">
          <button type="button" ref="confirmCancelButton" class="chapter-manager__button" tabindex="0" @click="cancelDelete">
            取消
          </button>
          <button
            type="button"
            class="chapter-manager__button chapter-manager__button--danger"
            tabindex="0"
            @click="confirmDelete"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.chapter-manager {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chapter-manager > :first-child {
  flex: 1;
}

/* 操作失败的说明浮在侧栏底部，不推动章节树。 */
.chapter-manager__notice {
  position: absolute;
  right: var(--space-4);
  bottom: var(--space-4);
  left: var(--space-4);
  z-index: var(--z-toast);
  display: flex;
  justify-content: center;
}

.chapter-manager__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 18vh;
  background: var(--color-scrim);
  animation: chapter-manager-fade var(--duration-base) var(--ease-out);
}

@keyframes chapter-manager-fade {
  from {
    opacity: 0;
  }
}

.chapter-manager__confirm {
  width: 360px;
  max-width: calc(100vw - 2 * var(--space-8));
  box-sizing: border-box;
  padding: var(--space-7) var(--space-7) var(--space-6);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-dialog);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  -webkit-user-select: none;
  user-select: none;
  animation: chapter-manager-dialog-in var(--duration-slow) var(--ease-out);
}

@keyframes chapter-manager-dialog-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
}

.chapter-manager__confirm-title {
  margin: 0 0 var(--space-3);
  font-size: var(--text-l);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
}

.chapter-manager__confirm-text {
  margin: 0 0 var(--space-7);
  color: var(--color-text-secondary);
}

.chapter-manager__confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-4);
}

.chapter-manager__button {
  min-width: 72px;
  height: var(--control-h-m);
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  box-shadow: inset 0 0 0 1px var(--color-separator);
  color: var(--color-text);
  font: inherit;
  font-weight: var(--weight-medium);
}

.chapter-manager__button:hover {
  background: var(--color-fill-pressed);
}

/*
 * 对话框中焦点所在的按钮总是标出：Enter / Space 作用于它，必须一眼看出是"取消"还是"删除"。
 * 不用 :focus-visible——WebKit 对脚本设置的按钮焦点不匹配它，打开对话框时看不出焦点在哪。
 * 描边留出间距，落在对话框底色上，红色按钮上也清楚。
 */
.chapter-manager__button:focus {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.chapter-manager__button--danger {
  background: var(--color-danger);
  box-shadow: none;
  color: var(--color-text-on-accent);
}

.chapter-manager__button--danger:hover {
  background: var(--color-danger-hover);
}
</style>
