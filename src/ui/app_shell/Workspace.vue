<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ProjectSession } from '../../application/project_session.ts'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { findChapter } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { hasContent } from '../../domain/document/document.ts'
import ChapterManager from '../chapter_tree/ChapterManager.vue'
import SaveStatus from './SaveStatus.vue'
import ChapterEditor from '../editor/ChapterEditor.vue'
import { useServices } from '../services.ts'
import { useSession } from './use_session.ts'
import { restoreUiState, serializeUiState } from './ui_state.ts'
import { messageForStorageFailure } from './storage_messages.ts'
import { appendImage } from '../editor/markdown_commands.ts'
import DocumentPreview from '../preview/DocumentPreview.vue'
import {
  exportDocument,
  previewDocument,
  type ExportFormat,
} from '../../application/document_output.ts'
import { messageForOutputFailure } from './output_messages.ts'

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

const { shell, output } = useServices()
const { document, status, lastError } = useSession(props.session)

const selectedId = ref<ChapterId | null>(null)
/** 工作区内操作（如插入图片）的错误说明；不属于保存状态。 */
const actionError = ref<string | null>(null)
const editor = ref<InstanceType<typeof ChapterEditor> | null>(null)
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

function updateContent(chapterId: ChapterId, text: string): void {
  props.session.setContent(chapterId, text)
}

/** 正文区模式：编辑当前章节，或全文预览。 */
const mode = ref<'edit' | 'preview'>('edit')
const previewHtml = ref('')
const previewError = ref<string | null>(null)
const PREVIEW_DELAY_MS = 400
let previewTimer: ReturnType<typeof setTimeout> | null = null
/** 只采用最新一次请求的结果，避免较慢的旧请求覆盖新内容。 */
let previewRequest = 0

async function refreshPreview(): Promise<void> {
  const request = ++previewRequest
  const result = await previewDocument(output, props.session.path, document.value)
  if (request !== previewRequest || mode.value !== 'preview') return
  if (result.ok) {
    previewHtml.value = result.value
    previewError.value = null
  } else {
    previewError.value = messageForOutputFailure(result.error)
  }
}

function togglePreview(): void {
  mode.value = mode.value === 'edit' ? 'preview' : 'edit'
  if (mode.value === 'preview') {
    previewHtml.value = ''
    void refreshPreview()
  }
}

// 预览打开时，文档变化后防抖刷新。
watch(document, () => {
  if (mode.value !== 'preview') return
  if (previewTimer !== null) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    void refreshPreview()
  }, PREVIEW_DELAY_MS)
})

onBeforeUnmount(() => {
  if (previewTimer !== null) clearTimeout(previewTimer)
})

const exportMenuOpen = ref(false)
/** 正在导出的格式；导出期间禁用导出菜单，避免重复写同一文件。 */
const exporting = ref<ExportFormat | null>(null)
const exportNotice = ref<{ readonly message: string; readonly path: string } | null>(null)

/** 文件名中不允许的字符替换为 -，空标题使用默认名。 */
function exportBaseName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
  return name.length > 0 ? name : '未命名文档'
}

async function exportAs(format: ExportFormat): Promise<void> {
  exportMenuOpen.value = false
  actionError.value = null
  exportNotice.value = null
  const target = await shell.pickExportPath(format, exportBaseName(document.value.title))
  if (target === null) return
  exporting.value = format
  try {
    const result = await exportDocument(output, props.session.path, document.value, format, target)
    if (!result.ok) {
      actionError.value = messageForOutputFailure(result.error)
      return
    }
    const fileName = target.split(/[\\/]/).pop() ?? target
    const missing = result.value.missingImages.length
    exportNotice.value = {
      message:
        missing > 0
          ? `已导出 ${fileName}，其中 ${missing} 张图片无法嵌入，已用文字占位。`
          : `已导出 ${fileName}`,
      path: target,
    }
  } finally {
    exporting.value = null
  }
}

/** 插入图片：选择文件 → 复制进项目 assets/ → 在发起请求的章节中插入引用。 */
async function insertImage(chapterId: ChapterId): Promise<void> {
  actionError.value = null
  const source = await shell.pickImageFile()
  if (source === null) return
  const result = await props.session.importAsset(source)
  if (!result.ok) {
    actionError.value = messageForStorageFailure(result.error)
    return
  }
  const { reference, fileName } = result.value
  const alt = fileName.replace(/\.[^.]+$/, '')
  if (editor.value?.insertImage(chapterId, reference, alt)) return
  // 选择文件期间切换了章节：追加到发起请求的章节末尾，不插错位置。
  const text = props.session.document.contents.get(chapterId)
  if (text !== undefined) props.session.setContent(chapterId, appendImage(text, reference, alt))
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
        <button type="button" class="workspace__preview-toggle" @click="togglePreview">
          {{ mode === 'preview' ? '返回编辑' : '预览' }}
        </button>
        <div class="workspace__export">
          <button
            type="button"
            aria-haspopup="menu"
            :disabled="exporting !== null"
            @click="exportMenuOpen = !exportMenuOpen"
          >
            {{ exporting ? '正在导出…' : '导出' }}
          </button>
          <ul v-if="exportMenuOpen" class="workspace__export-menu" role="menu">
            <li><button type="button" role="menuitem" @click="exportAs('docx')">导出 Word（.docx）</button></li>
            <li><button type="button" role="menuitem" @click="exportAs('pdf')">导出 PDF</button></li>
          </ul>
        </div>
        <button type="button" @click="emit('new-project')">新建</button>
        <button type="button" @click="emit('open-project')">打开</button>
      </div>
    </header>

    <p v-if="exportNotice" class="workspace__notice" role="status">
      <span>{{ exportNotice.message }}</span>
      <span>
        <button type="button" @click="shell.revealFile(exportNotice.path)">在文件夹中显示</button>
        <button type="button" aria-label="关闭提示" @click="exportNotice = null">×</button>
      </span>
    </p>
    <p v-if="actionError" class="workspace__error" role="alert">
      {{ actionError }}
      <button type="button" aria-label="关闭提示" @click="actionError = null">×</button>
    </p>

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
        <div v-if="mode === 'preview'" class="workspace__preview">
          <p v-if="previewError" class="workspace__preview-error" role="alert">{{ previewError }}</p>
          <DocumentPreview
            :html="previewHtml"
            :active-chapter-id="selectedId"
            :to-display-url="shell.toDisplayUrl"
            @select="selectedId = $event"
          />
        </div>
        <ChapterEditor
          v-else-if="selectedChapter && selectedId !== null"
          ref="editor"
          :chapter-id="selectedId"
          :content="document.contents.get(selectedId) ?? ''"
          :number="selectedNumber"
          :title="selectedChapter.title"
          @change="updateContent"
          @request-image="insertImage"
        />
        <p v-else class="workspace__placeholder">选择或新建一个章节开始写作。</p>
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

.workspace__export {
  position: relative;
}

.workspace__export-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 11rem;
  margin: 0;
  padding: 4px;
  list-style: none;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
}

.workspace__actions .workspace__export-menu button {
  display: block;
  width: 100%;
  border: none;
  text-align: left;
}

.workspace__notice {
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0;
  padding: 6px 12px;
  background: #ecfdf5;
  color: #065f46;
  font-size: 13px;
}

.workspace__notice button {
  border: none;
  background: none;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
}

.workspace__error {
  flex: none;
  display: flex;
  justify-content: space-between;
  margin: 0;
  padding: 6px 12px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 13px;
}

.workspace__error button {
  border: none;
  background: none;
  color: inherit;
  font-size: 16px;
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

/* 编辑器自身滚动（CodeMirror scroller），与章节栏互不影响。 */
.workspace__main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.workspace__preview {
  height: 100%;
  overflow-y: auto;
}

.workspace__preview-error {
  margin: 0;
  padding: 8px 32px;
  color: #b91c1c;
}

.workspace__placeholder {
  padding: 24px 32px;
  color: #6b7280;
}
</style>
