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

const props = withDefaults(
  defineProps<{
    /** 初始章节树；调用方保证是已校验的可信树。 */
    initialTree?: ChapterTreeModel
    /** 初始选中章节 id。 */
    initialSelectedId?: ChapterId | null
  }>(),
  {
    initialTree: () => [],
    initialSelectedId: null,
  },
)

const tree = ref<ChapterTreeModel>(props.initialTree)
const selectedId = ref<ChapterId | null>(props.initialSelectedId)
const editingId = ref<ChapterId | null>(null)
const deletingId = ref<ChapterId | null>(null)
const errorMessage = ref<string | null>(null)
const confirmCancelButton = ref<HTMLButtonElement | null>(null)

const deleting = computed(() =>
  deletingId.value === null ? null : findChapter(tree.value, deletingId.value),
)
const deletingTitle = computed(() => deleting.value?.title ?? '')
const deletingChildCount = computed(() => deleting.value?.children.length ?? 0)

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
        <template v-if="deletingChildCount > 0">
          该章节包含 {{ deletingChildCount }} 个子章节，删除后会一并移除。
        </template>
      </p>
      <button type="button" @click="confirmDelete">确认删除</button>
      <button type="button" ref="confirmCancelButton" @click="cancelDelete">取消</button>
    </div>

    <p v-if="errorMessage !== null" class="chapter-manager__error" role="alert">
      {{ errorMessage }}
    </p>

    <ChapterTree
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
    />
  </section>
</template>

<style scoped>
.chapter-manager__confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: #fef2f2;
}

.chapter-manager__confirm-text {
  flex-basis: 100%;
  margin: 0;
}

.chapter-manager__error {
  margin: 0 0 0.75rem;
  color: #b91c1c;
}
</style>
