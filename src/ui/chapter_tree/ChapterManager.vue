<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import ChapterTree from './ChapterTree.vue'
import { appendChapter } from '../../application/create_chapter.ts'
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
 * 持有章节树与选中态，把新增/重命名/删除/移动都交给 Application 用例执行，
 * 失败原因在这里映射成用户文案。ChapterTree 仍只负责树的展示与树内交互
 * （选择、折叠、拖拽），Domain 规则不在这层重写。
 */
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

type EditKind = 'create-root' | 'create-child' | 'rename'

const tree = ref<ChapterTreeModel>(props.initialTree)
const selectedId = ref<ChapterId | null>(props.initialSelectedId)
const errorMessage = ref<string | null>(null)

const editKind = ref<EditKind | null>(null)
const editTitle = ref('')
const confirmingDelete = ref(false)
const titleInput = ref<HTMLInputElement | null>(null)
const confirmCancelButton = ref<HTMLButtonElement | null>(null)
const deleteButton = ref<HTMLButtonElement | null>(null)

const selectedTitle = computed(() =>
  selectedId.value === null ? '' : (findChapter(tree.value, selectedId.value)?.title ?? ''),
)

const editLabel = computed(() => (editKind.value === 'rename' ? '新标题' : '章节标题'))
const canSubmitEdit = computed(() => editTitle.value.trim().length > 0)

/** 打开表单后把焦点移到唯一的输入框，保证键盘可继续操作。 */
async function focusTitleInput(): Promise<void> {
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
}

function clearError(): void {
  errorMessage.value = null
}

function startCreateRoot(): void {
  clearError()
  confirmingDelete.value = false
  editKind.value = 'create-root'
  editTitle.value = ''
  void focusTitleInput()
}

function startCreateChild(): void {
  if (selectedId.value === null) return
  clearError()
  confirmingDelete.value = false
  editKind.value = 'create-child'
  editTitle.value = ''
  void focusTitleInput()
}

function startRename(): void {
  if (selectedId.value === null) return
  clearError()
  confirmingDelete.value = false
  editKind.value = 'rename'
  editTitle.value = selectedTitle.value
  void focusTitleInput()
}

function cancelEdit(): void {
  editKind.value = null
  editTitle.value = ''
}

function startDelete(): void {
  if (selectedId.value === null) return
  clearError()
  editKind.value = null
  confirmingDelete.value = true
  void focusConfirmCancel()
}

async function focusConfirmCancel(): Promise<void> {
  await nextTick()
  confirmCancelButton.value?.focus()
}

async function cancelDelete(): Promise<void> {
  if (!confirmingDelete.value) return
  confirmingDelete.value = false
  // 取消后把焦点还给触发删除的按钮，键盘用户不迷路。
  await nextTick()
  deleteButton.value?.focus()
}

/** 新增 / 重命名共用一个内联表单，提交后按 kind 分派到对应 Application 用例。 */
function submitEdit(): void {
  const kind = editKind.value
  if (kind === null) return
  const title = editTitle.value.trim()
  if (title.length === 0) return

  if (kind === 'rename') {
    const id = selectedId.value
    if (id === null) return
    const result = renameChapter(tree.value, id, title)
    if (!result.ok) {
      errorMessage.value = messageForRename(result.reason)
      return
    }
    tree.value = result.tree
    finishSuccess()
    return
  }

  const parentId = kind === 'create-root' ? null : selectedId.value
  const result = appendChapter(tree.value, parentId, title)
  if (!result.ok) {
    errorMessage.value = messageForInsert(result.reason)
    return
  }
  tree.value = result.tree
  // 新增成功后选中新章节。
  selectedId.value = result.chapterId
  finishSuccess()
}

function confirmDelete(): void {
  const id = selectedId.value
  if (id === null) return
  const result = removeChapter(tree.value, id)
  if (!result.ok) {
    errorMessage.value = messageForRemove(result.reason)
    return
  }
  tree.value = result.tree
  // 被删章节已不存在，选择必须清空，不能指向不存在的章节。
  selectedId.value = null
  finishSuccess()
}

function finishSuccess(): void {
  errorMessage.value = null
  editKind.value = null
  editTitle.value = ''
  confirmingDelete.value = false
}

function select(chapterId: ChapterId): void {
  // 重复点击当前章节不算切换上下文，保留未完成的新增/重命名/删除确认。
  if (chapterId === selectedId.value) return
  selectedId.value = chapterId
  // 选择变化即放弃未完成的新增/重命名/删除确认，避免操作落到新的选中章节。
  editKind.value = null
  editTitle.value = ''
  confirmingDelete.value = false
}

function move(intent: MoveIntent): void {
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
  }
}
</script>

<template>
  <section class="chapter-manager">
    <div class="chapter-manager__toolbar" role="toolbar" aria-label="章节操作">
      <button type="button" @click="startCreateRoot">新建根章节</button>
      <button type="button" :disabled="selectedId === null" @click="startCreateChild">
        新建子章节
      </button>
      <button type="button" :disabled="selectedId === null" @click="startRename">重命名</button>
      <button type="button" ref="deleteButton" :disabled="selectedId === null" @click="startDelete">
        删除
      </button>
    </div>

    <form
      v-if="editKind !== null"
      class="chapter-manager__form"
      @submit.prevent="submitEdit"
      @keydown.esc="cancelEdit"
    >
      <label class="chapter-manager__label" for="chapter-manager-title">{{ editLabel }}</label>
      <input
        id="chapter-manager-title"
        ref="titleInput"
        v-model="editTitle"
        type="text"
        autocomplete="off"
      />
      <button type="submit" :disabled="!canSubmitEdit">确定</button>
      <button type="button" @click="cancelEdit">取消</button>
    </form>

    <div
      v-if="confirmingDelete"
      class="chapter-manager__confirm"
      role="group"
      aria-label="确认删除章节"
      @keydown.esc="cancelDelete"
    >
      <p class="chapter-manager__confirm-text">
        确定删除「{{ selectedTitle || '选中的章节' }}」吗？它的所有子章节也会一起删除。
      </p>
      <button type="button" @click="confirmDelete">确认删除</button>
      <button type="button" ref="confirmCancelButton" @click="cancelDelete">取消</button>
    </div>

    <p v-if="errorMessage !== null" class="chapter-manager__error" role="alert">
      {{ errorMessage }}
    </p>

    <ChapterTree :tree="tree" :selected-id="selectedId" @select="select" @move="move" />
  </section>
</template>

<style scoped>
.chapter-manager__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.chapter-manager__form,
.chapter-manager__confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
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
