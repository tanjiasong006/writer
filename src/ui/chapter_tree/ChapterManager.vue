<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import ChapterTree from './ChapterTree.vue'
import {
  appendChapter,
  createChapterAfter,
  type CreateChapterResult,
} from '../../application/create_chapter.ts'
import { moveChapterTo, type MoveIntent } from '../../application/move_chapter.ts'
import { renameChapter } from '../../application/rename_chapter.ts'
import { removeChapter } from '../../application/remove_chapter.ts'
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
  /**
   * 章节是否有正文。没有子章节且没有正文的章节直接删除，不需要确认（ui-spec §23）。
   * 不提供时保守地认为都有正文，删除总是先确认。
   */
  hasContent?: (chapterId: ChapterId) => boolean
}>()

const editingId = ref<ChapterId | null>(null)
const deletingId = ref<ChapterId | null>(null)
const errorMessage = ref<string | null>(null)
const confirmCancelButton = ref<HTMLButtonElement | null>(null)

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

function requestDelete(chapterId: ChapterId): void {
  clearError()
  editingId.value = null
  deletingId.value = chapterId
  // 没有子章节也没有正文：删除不会丢失任何内容，直接删除。
  if (countDescendants(tree.value, chapterId) === 0 && !chapterHasContent(chapterId)) {
    confirmDelete()
    return
  }
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
  const result = removeChapter(tree.value, id)
  if (!result.ok) {
    errorMessage.value = messageForRemove(result.reason)
    return
  }
  tree.value = result.tree
  // 选中章节被删除（或被删章节的子树包含选中章节）时，选择必须清空。
  if (selectedId.value !== null && findChapter(tree.value, selectedId.value) === null) {
    selectedId.value = null
  }
  editingId.value = null
  deletingId.value = null
  errorMessage.value = null
}

function cancelDelete(): void {
  deletingId.value = null
}

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
  <section class="chapter-manager">
    <div
      v-if="deletingId !== null"
      class="chapter-manager__confirm"
      role="alertdialog"
      aria-label="确认删除章节"
      @keydown.esc="cancelDelete"
    >
      <p class="chapter-manager__confirm-text">
        确定删除「{{ deletingTitle || '选中的章节' }}」吗？
        <template v-if="deletingHasContent && deletingDescendantCount > 0">
          该章节包含正文以及 {{ deletingDescendantCount }} 个子章节，删除后会一并移除。
        </template>
        <template v-else-if="deletingDescendantCount > 0">
          该章节包含 {{ deletingDescendantCount }} 个子章节，删除后会一并移除。
        </template>
        <template v-else>该章节包含正文，删除后无法恢复。</template>
      </p>
      <div class="chapter-manager__confirm-actions">
        <button type="button" ref="confirmCancelButton" class="chapter-manager__button" @click="cancelDelete">
          取消
        </button>
        <button
          type="button"
          class="chapter-manager__button chapter-manager__button--danger"
          @click="confirmDelete"
        >
          确认删除
        </button>
      </div>
    </div>

    <p v-if="errorMessage !== null" class="chapter-manager__error" role="alert">
      {{ errorMessage }}
    </p>

    <ChapterTree
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
  </section>
</template>

<style scoped>
.chapter-manager__confirm {
  margin: 0 4px 8px;
  padding: 10px 12px;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: #fef2f2;
  font-size: 13px;
  line-height: 1.6;
}

.chapter-manager__confirm-text {
  margin: 0 0 8px;
  color: #111827;
}

.chapter-manager__confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.chapter-manager__button {
  padding: 4px 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #ffffff;
  color: #111827;
  font-size: 13px;
  cursor: pointer;
}

.chapter-manager__button:hover {
  background: #f9fafb;
}

.chapter-manager__button--danger {
  border-color: #dc2626;
  background: #dc2626;
  color: #ffffff;
}

.chapter-manager__button--danger:hover {
  background: #b91c1c;
}

.chapter-manager__error {
  margin: 0 4px 8px;
  color: #b91c1c;
  font-size: 13px;
}
</style>
