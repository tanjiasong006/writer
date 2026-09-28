<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ProjectSession } from '../../application/project_session.ts'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { findChapter } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { hasContent } from '../../domain/document/document.ts'
import ChapterManager from '../chapter_tree/ChapterManager.vue'
import SaveStatus from './SaveStatus.vue'
import { useServices } from '../services.ts'
import { useSession } from './use_session.ts'
import { restoreUiState, serializeUiState } from './ui_state.ts'

/**
 * 已打开项目的工作区：顶栏（标题、保存状态、项目操作）+ 左侧章节树 + 右侧正文区。
 * 两侧独立滚动（ui-spec §27）。文档修改一律经 ProjectSession。
 */
const props = defineProps<{
  session: ProjectSession
}>()

const emit = defineEmits<{
  'new-project': []
  'open-project': []
}>()

const { shell } = useServices()
const { document, status, lastError } = useSession(props.session)

const selectedId = ref<ChapterId | null>(null)
const collapsedIds = shallowRef<ReadonlySet<ChapterId>>(new Set())
/** 界面状态恢复完成前不回写，避免用默认值覆盖磁盘上的状态。 */
const uiStateReady = ref(false)

onMounted(async () => {
  const restored = restoreUiState(await shell.loadUiState(props.session.path), document.value.tree)
  selectedId.value = restored.selectedId
  collapsedIds.value = restored.collapsedIds
  uiStateReady.value = true
})

const UI_STATE_DELAY_MS = 500
let uiStateTimer: ReturnType<typeof setTimeout> | null = null

function persistUiState(): void {
  if (uiStateTimer !== null) clearTimeout(uiStateTimer)
  uiStateTimer = null
  void shell.saveUiState(
    props.session.path,
    serializeUiState({ selectedId: selectedId.value, collapsedIds: collapsedIds.value }),
  )
}

watch([selectedId, collapsedIds], () => {
  if (!uiStateReady.value) return
  if (uiStateTimer !== null) clearTimeout(uiStateTimer)
  uiStateTimer = setTimeout(persistUiState, UI_STATE_DELAY_MS)
})

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void props.session.save()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (uiStateTimer !== null) persistUiState()
})

function applyTree(tree: ChapterTree): void {
  props.session.applyTree(tree)
}

function chapterHasContent(chapterId: ChapterId): boolean {
  return hasContent(document.value, chapterId)
}

function commitTitle(event: Event): void {
  const input = event.target as HTMLInputElement
  const title = input.value.trim()
  if (title.length === 0) {
    input.value = document.value.title
    return
  }
  props.session.setTitle(title)
}

const selectedChapter = computed(() =>
  selectedId.value === null ? null : findChapter(document.value.tree, selectedId.value),
)

const selectedNumber = computed(() => {
  if (selectedId.value === null) return ''
  return (computeChapterNumbers(document.value.tree).get(selectedId.value) ?? []).join('.')
})
</script>

<template>
  <div class="workspace">
    <header class="workspace__bar">
      <input
        class="workspace__title"
        type="text"
        aria-label="文档标题"
        :value="document.title"
        @change="commitTitle"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <SaveStatus :status="status" :error="lastError" @retry="session.save()" />
      <div class="workspace__actions">
        <button type="button" @click="emit('new-project')">新建</button>
        <button type="button" @click="emit('open-project')">打开</button>
      </div>
    </header>

    <div class="workspace__body">
      <aside class="workspace__sidebar">
        <ChapterManager
          v-model:selected-id="selectedId"
          v-model:collapsed-ids="collapsedIds"
          :tree="document.tree"
          :has-content="chapterHasContent"
          @update:tree="applyTree"
        />
      </aside>

      <main class="workspace__main">
        <slot name="editor" :chapter-id="selectedId" :number="selectedNumber">
          <div v-if="selectedChapter" class="workspace__chapter">
            <h2 class="workspace__chapter-title">
              <span class="workspace__chapter-number">{{ selectedNumber }}</span>
              {{ selectedChapter.title }}
            </h2>
          </div>
          <p v-else class="workspace__placeholder">选择或新建一个章节开始写作。</p>
        </slot>
      </main>
    </div>
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.workspace__bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid #e5e7eb;
  background: #fafafa;
}

.workspace__title {
  flex: 0 1 280px;
  min-width: 80px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
}

.workspace__title:hover,
.workspace__title:focus {
  border-color: #d1d5db;
  background: #ffffff;
  outline: none;
}

.workspace__actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.workspace__actions button {
  padding: 4px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #ffffff;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
}

.workspace__body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* 章节栏默认 260px（ui-spec §31），与正文区各自滚动（§27）。 */
.workspace__sidebar {
  flex: none;
  width: 260px;
  overflow-y: auto;
  padding: 8px 4px 8px 8px;
  border-right: 1px solid #e5e7eb;
}

.workspace__main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}

.workspace__chapter {
  padding: 24px 32px;
}

.workspace__chapter-title {
  margin: 0;
  font-size: 20px;
}

.workspace__chapter-number {
  margin-right: 8px;
  color: #6b7280;
}

.workspace__placeholder {
  padding: 24px 32px;
  color: #6b7280;
}
</style>
