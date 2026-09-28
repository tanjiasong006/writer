<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
import { appendImage } from '../editor/markdown.ts'
import DocumentPreview from '../preview/DocumentPreview.vue'
import {
  exportDocument,
  previewDocument,
  type ExportFormat,
} from '../../application/document_output.ts'
import { messageForOutputFailure } from './output_messages.ts'
import DocumentStylePanel from '../document_style/DocumentStylePanel.vue'
import EditorToolbar from '../editor/EditorToolbar.vue'
import ImageLayoutControls from '../editor/ImageLayoutControls.vue'
import type { ToolbarCommand, ToolbarState } from '../editor/commands.ts'
import type { SelectedFigure } from '../editor/image_layout.ts'
import PopupMenu, { type MenuAnchor, type MenuEntry } from '../common/PopupMenu.vue'
import Toast from '../common/Toast.vue'
import Icon from '../common/Icon.vue'
import {
  resolveTheme,
  type ImageOverride,
  type StyleOverrides,
  type ThemeId,
} from '../../domain/document_style/document_style.ts'

/**
 * 已打开项目的工作区。
 *
 * - 左侧栏：文档名与保存状态（文档菜单：新建 / 打开）、章节树；宽度可拖动调整。
 * - 右侧：一行顶栏（左边是正文工具，右边是样式 / 预览 / 导出）+ 正文编辑器或全文预览。
 *   正文工具由编辑器提供状态与命令，放在顶栏里，正文上方不再叠加第二条工具栏。
 * - 两侧独立滚动（ui-spec §27）。提示浮在正文区底部，不挤压布局。文档修改一律经 ProjectSession。
 */
const props = defineProps<{
  session: ProjectSession
  /** 应用层的提示（如打开项目时的说明），与工作区自己的提示显示在同一处。 */
  notice?: string | null
}>()

const emit = defineEmits<{
  'new-project': []
  'open-project': []
  'dismiss-notice': []
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
    return
  }
  // 全文预览中按 Esc 回到编辑（菜单、面板、对话框、重命名自己处理的 Esc 不会走到这里）。
  if (event.key === 'Escape' && !event.defaultPrevented && mode.value === 'preview') {
    event.preventDefault()
    void setMode('edit')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (uiStateTimer !== null) persistUiState()
})

/** 窗口标题显示当前文档名；离开工作区时恢复为应用名。 */
watch(
  () => document.value.title,
  (title) => shell.setWindowTitle(`${title.trim() || '未命名文档'} — Writer`),
  { immediate: true },
)
onBeforeUnmount(() => shell.setWindowTitle('Writer'))

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

async function setMode(next: 'edit' | 'preview'): Promise<void> {
  if (mode.value === next) return
  mode.value = next
  scrolled.value = false
  if (next === 'preview') {
    previewHtml.value = ''
    void refreshPreview()
    return
  }
  // 从预览回到编辑：继续在当前章节写作。
  await nextTick()
  editor.value?.focus()
}

function togglePreview(): void {
  void setMode(mode.value === 'edit' ? 'preview' : 'edit')
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

const exportMenu = ref<(MenuAnchor & { keyboard: boolean }) | null>(null)
const EXPORT_ITEMS: readonly MenuEntry[] = [
  { id: 'docx', label: '导出 Word（.docx）' },
  { id: 'pdf', label: '导出 PDF' },
]

function toggleExportMenu(event: MouseEvent): void {
  exportMenu.value = exportMenu.value ? null : anchorOf(event, 'end')
}

/** 菜单按钮的位置；由键盘（Enter / Space，detail 为 0）打开时第一项获得焦点。 */
function anchorOf(event: MouseEvent, align: 'start' | 'end'): MenuAnchor & { keyboard: boolean } {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { rect, align, keyboard: event.detail === 0 }
}

/** 导出成功的提示在一段时间后自动消失；错误一直显示到用户关闭。 */
const NOTICE_DURATION_MS = 8000
let noticeTimer: ReturnType<typeof setTimeout> | null = null

function showExportNotice(notice: { readonly message: string; readonly path: string }): void {
  exportNotice.value = notice
  if (noticeTimer !== null) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    noticeTimer = null
    exportNotice.value = null
  }, NOTICE_DURATION_MS)
}

onBeforeUnmount(() => {
  if (noticeTimer !== null) clearTimeout(noticeTimer)
})
/** 正在导出的格式；导出期间禁用导出菜单，避免重复写同一文件。 */
const exporting = ref<ExportFormat | null>(null)
const exportNotice = ref<{ readonly message: string; readonly path: string } | null>(null)

/** 文件名中不允许的字符替换为 -，空标题使用默认名。 */
function exportBaseName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
  return name.length > 0 ? name : '未命名文档'
}

async function exportAs(format: ExportFormat): Promise<void> {
  exportMenu.value = null
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
    showExportNotice({
      message:
        missing > 0
          ? `已导出 ${fileName}，其中 ${missing} 张图片无法嵌入，已用文字占位。`
          : `已导出 ${fileName}`,
      path: target,
    })
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

/** 正文中的图片引用 → 编辑器中可显示的地址（只显示项目内的文件）。 */
function resolveImage(reference: string): string | null {
  const path = props.session.assetPath(reference)
  return path === null ? null : shell.toDisplayUrl(path)
}

/** 章节树中按 Enter：回到编辑模式并把焦点交给正文编辑器。 */
async function openChapter(): Promise<void> {
  if (mode.value !== 'edit') {
    await setMode('edit')
    return
  }
  await nextTick()
  editor.value?.focus()
}

function chapterHasContent(chapterId: ChapterId): boolean {
  return hasContent(document.value, chapterId)
}

const titleInput = ref<HTMLInputElement | null>(null)

function commitTitle(event: Event): void {
  const input = event.target as HTMLInputElement
  const title = input.value.trim()
  if (title.length === 0) {
    input.value = document.value.title
    return
  }
  props.session.setTitle(title)
}

/**
 * 只依赖章节树：编辑正文不改变树的引用，computed 值不变时不会触发下游重算，
 * 输入时不必为每次按键重新计算整棵树的编号。
 */
const tree = computed(() => document.value.tree)
const numbers = computed(() => computeChapterNumbers(tree.value))

const selectedChapter = computed(() =>
  selectedId.value === null ? null : findChapter(tree.value, selectedId.value),
)

const selectedNumber = computed(() =>
  selectedId.value === null ? '' : (numbers.value.get(selectedId.value) ?? []).join('.'),
)

/**
 * 文档样式（整本书的设置，不属于正文工具栏）。与 tree 一样只依赖样式对象：
 * 编辑正文时样式引用不变，主题不会重新解析，编辑器与预览的样式也不会重算。
 */
const documentStyle = computed(() => document.value.style)
const theme = computed(() => resolveTheme(documentStyle.value))
const stylePanelOpen = ref(false)
const styleButton = ref<HTMLButtonElement | null>(null)
const stylePanel = ref<HTMLElement | null>(null)

async function toggleStylePanel(): Promise<void> {
  stylePanelOpen.value = !stylePanelOpen.value
  if (!stylePanelOpen.value) return
  await nextTick()
  stylePanel.value?.focus({ preventScroll: true })
}

/** 用键盘关闭面板时焦点回到"样式"按钮。 */
function closeStylePanel(event?: KeyboardEvent): void {
  event?.preventDefault()
  stylePanelOpen.value = false
  if (event) styleButton.value?.focus()
}

function selectTheme(id: ThemeId): void {
  props.session.selectTheme(id)
}

function overrideStyle(patch: StyleOverrides): void {
  props.session.overrideStyle(patch)
}

function setImageLayout(key: string, layout: ImageOverride | null): void {
  props.session.setImageLayout(key, layout)
}

/** 编辑器报告的工具栏状态与选中的图片（显示在顶栏）。 */
const tools = shallowRef<ToolbarState | null>(null)
const figure = shallowRef<SelectedFigure | null>(null)

function showTools(state: ToolbarState, selected: SelectedFigure | null): void {
  tools.value = state
  figure.value = selected
}

function runCommand(command: ToolbarCommand): void {
  editor.value?.runCommand(command)
}

function changeFigureLayout(patch: ImageOverride): void {
  editor.value?.changeFigureLayout(patch)
}

/** 正文滚动离开顶部后，顶栏下方出现一条分隔线，说明内容在它下面继续。 */
const scrolled = ref(false)

function onMainScroll(event: Event): void {
  const target = event.target as HTMLElement
  if (target.classList?.contains('chapter-editor__scroller') || target.classList?.contains('workspace__preview')) {
    scrolled.value = target.scrollTop > 0
  }
}

/** 文档菜单：重命名文档、新建 / 打开其他文档。 */
const documentMenu = ref<(MenuAnchor & { keyboard: boolean }) | null>(null)
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'
const DOCUMENT_ITEMS: readonly MenuEntry[] = [
  { id: 'rename', label: '重命名文档' },
  { separator: true },
  { id: 'new', label: '新建文档…', shortcut: `${mod}N` },
  { id: 'open', label: '打开文档…', shortcut: `${mod}O` },
]

function toggleDocumentMenu(event: MouseEvent): void {
  documentMenu.value = documentMenu.value ? null : anchorOf(event, 'start')
}

async function onDocumentMenu(id: string): Promise<void> {
  documentMenu.value = null
  if (id === 'new') emit('new-project')
  else if (id === 'open') emit('open-project')
  else {
    await nextTick()
    titleInput.value?.focus()
    titleInput.value?.select()
  }
}

/**
 * 侧栏宽度（ui-spec §31）：默认 260px，拖动分隔线在 180–480px 之间调整，双击恢复默认；
 * 同时保证正文区至少留出 MIN_MAIN 宽度。宽度是本机的界面偏好，不随项目保存。
 */
const SIDEBAR_DEFAULT = 260
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480
const MIN_MAIN = 440
const SIDEBAR_KEY = 'writer.sidebar-width'

function storedSidebarWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(SIDEBAR_KEY))
    return Number.isFinite(value) && value > 0 ? value : SIDEBAR_DEFAULT
  } catch {
    return SIDEBAR_DEFAULT
  }
}

const sidebarPreferred = ref(storedSidebarWidth())
const windowWidth = ref(window.innerWidth)
const sidebarMax = computed(() => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, windowWidth.value - MIN_MAIN)))
const sidebarWidth = computed(() => Math.round(Math.min(Math.max(sidebarPreferred.value, SIDEBAR_MIN), sidebarMax.value)))
const resizing = ref(false)

function onWindowResize(): void {
  windowWidth.value = window.innerWidth
}

onMounted(() => window.addEventListener('resize', onWindowResize))
onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize))

function setSidebarWidth(width: number): void {
  sidebarPreferred.value = Math.min(Math.max(width, SIDEBAR_MIN), sidebarMax.value)
  try {
    window.localStorage.setItem(SIDEBAR_KEY, String(Math.round(sidebarPreferred.value)))
  } catch {
    // 偏好没有保存下来不影响使用。
  }
}

function startResize(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  const startX = event.clientX
  const startWidth = sidebarWidth.value
  resizing.value = true
  handle.setPointerCapture?.(event.pointerId)
  const move = (moveEvent: PointerEvent) => setSidebarWidth(startWidth + moveEvent.clientX - startX)
  const end = () => {
    resizing.value = false
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

const RESIZE_STEP = 16

function onResizeKey(event: KeyboardEvent): void {
  const next: Record<string, number> = {
    ArrowLeft: sidebarWidth.value - RESIZE_STEP,
    ArrowRight: sidebarWidth.value + RESIZE_STEP,
    Home: SIDEBAR_MIN,
    End: sidebarMax.value,
  }
  if (!(event.key in next)) return
  event.preventDefault()
  setSidebarWidth(next[event.key])
}
</script>


<template>
  <div
    class="workspace"
    :class="{ 'workspace--resizing': resizing }"
    :style="{ '--sidebar-w': `${sidebarWidth}px` }"
  >
    <aside class="workspace__sidebar" aria-label="文档结构">
      <div class="workspace__document">
        <div class="workspace__document-row">
          <input
            ref="titleInput"
            class="workspace__title"
            type="text"
            aria-label="文档标题"
            spellcheck="false"
            :value="document.title"
            :title="document.title"
            @change="commitTitle"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <button
            type="button"
            class="workspace__icon-button"
            tabindex="0"
            aria-label="文档菜单"
            aria-haspopup="menu"
            :aria-expanded="documentMenu !== null"
            @click="toggleDocumentMenu"
          >
            <Icon name="chevron-down" />
          </button>
        </div>
        <SaveStatus class="workspace__save-status" :status="status" :error="lastError" @retry="session.save()" />
      </div>
      <PopupMenu
        v-if="documentMenu"
        label="文档"
        :items="DOCUMENT_ITEMS"
        :anchor="documentMenu"
        :keyboard="documentMenu.keyboard"
        @select="onDocumentMenu"
        @close="documentMenu = null"
      />

      <ChapterManager
        v-model:selected-id="selectedId"
        v-model:collapsed-ids="collapsedIds"
        class="workspace__chapters"
        :tree="document.tree"
        :has-content="chapterHasContent"
        @update:tree="applyTree"
        @open="openChapter"
      />

      <div
        class="workspace__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        :aria-valuenow="sidebarWidth"
        :aria-valuemin="SIDEBAR_MIN"
        :aria-valuemax="sidebarMax"
        tabindex="0"
        @pointerdown="startResize"
        @dblclick="setSidebarWidth(SIDEBAR_DEFAULT)"
        @keydown="onResizeKey"
      ></div>
    </aside>

    <main class="workspace__main" @scroll.capture="onMainScroll">
      <header class="workspace__bar" :class="{ 'workspace__bar--scrolled': scrolled }">
        <div class="workspace__tools">
          <EditorToolbar
            v-if="mode === 'edit' && selectedChapter"
            :state="tools"
            @command="runCommand"
          >
            <template v-if="figure" #context>
              <ImageLayoutControls :layout="figure.layout" @change="changeFigureLayout" />
            </template>
          </EditorToolbar>
          <span v-else-if="mode === 'preview'" class="workspace__mode">全文预览</span>
        </div>

        <div class="workspace__actions">
          <div class="workspace__anchor">
            <button
              ref="styleButton"
              type="button"
              class="workspace__action"
              tabindex="0"
              :class="{ 'workspace__action--open': stylePanelOpen }"
              aria-haspopup="dialog"
              :aria-expanded="stylePanelOpen"
              title="整本文档的字体、字号与主题"
              @click="toggleStylePanel"
            >
              样式
            </button>
            <div v-if="stylePanelOpen" class="workspace__backdrop" @click="closeStylePanel()"></div>
            <div
              v-if="stylePanelOpen"
              ref="stylePanel"
              class="workspace__popover"
              role="dialog"
              aria-label="文档样式"
              tabindex="-1"
              @keydown.esc="closeStylePanel"
            >
              <DocumentStylePanel
                :document-style="documentStyle"
                @select-theme="selectTheme"
                @override="overrideStyle"
                @reset="session.resetStyleOverrides()"
              />
            </div>
          </div>
          <button
            type="button"
            class="workspace__action"
            tabindex="0"
            :class="{ 'workspace__action--on': mode === 'preview' }"
            :aria-pressed="mode === 'preview'"
            :title="mode === 'preview' ? '回到编辑（Esc）' : '按导出的样子查看全文'"
            @click="togglePreview"
          >
            预览
          </button>
          <button
            type="button"
            class="workspace__action"
            tabindex="0"
            :class="{ 'workspace__action--open': exportMenu !== null }"
            aria-haspopup="menu"
            :aria-expanded="exportMenu !== null"
            :disabled="exporting !== null"
            @click="toggleExportMenu"
          >
            {{ exporting ? '正在导出…' : '导出' }}
          </button>
          <PopupMenu
            v-if="exportMenu"
            label="导出"
            menu-class="workspace__export-menu"
            backdrop-class="workspace__backdrop"
            :items="EXPORT_ITEMS"
            :anchor="exportMenu"
            :keyboard="exportMenu.keyboard"
            @select="exportAs($event as ExportFormat)"
            @close="exportMenu = null"
          />
        </div>
      </header>

      <div class="workspace__content">
        <div v-if="mode === 'preview'" class="workspace__preview">
          <p v-if="previewError" class="workspace__preview-error" role="alert">{{ previewError }}</p>
          <DocumentPreview
            :html="previewHtml"
            :active-chapter-id="selectedId"
            :to-display-url="shell.toDisplayUrl"
            :theme="theme"
            @select="selectedId = $event"
          />
        </div>
        <ChapterEditor
          v-else-if="selectedChapter && selectedId !== null"
          ref="editor"
          external-toolbar
          :chapter-id="selectedId"
          :content="document.contents.get(selectedId) ?? ''"
          :number="selectedNumber"
          :title="selectedChapter.title"
          :resolve-image="resolveImage"
          :theme="theme"
          :image-layouts="documentStyle.images"
          @change="updateContent"
          @request-image="insertImage"
          @image-layout="setImageLayout"
          @tools="showTools"
        />
        <div v-else class="workspace__placeholder">
          <p>{{ document.tree.length === 0 ? '新建一个章节，开始写作。' : '在左侧选择一个章节，开始写作。' }}</p>
        </div>
      </div>

      <div class="workspace__toasts">
        <Toast v-if="notice" class="app__notice" @dismiss="emit('dismiss-notice')">{{ notice }}</Toast>
        <Toast v-if="actionError" class="workspace__error" tone="error" @dismiss="actionError = null">
          {{ actionError }}
        </Toast>
        <Toast v-if="exportNotice" class="workspace__notice" @dismiss="exportNotice = null">
          {{ exportNotice.message }}
          <template #actions>
            <button type="button" @click="shell.revealFile(exportNotice.path)">在文件夹中显示</button>
          </template>
        </Toast>
      </div>
    </main>
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  height: 100vh;
}

.workspace--resizing {
  cursor: col-resize;
  -webkit-user-select: none;
  user-select: none;
}

/* 侧栏：略带色调的安静表面，与正文区之间只有一条细分隔线。 */
.workspace__sidebar {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  width: var(--sidebar-w);
  min-height: 0;
  border-right: 1px solid var(--color-separator);
  background: var(--color-bg-sidebar);
  -webkit-user-select: none;
  user-select: none;
}

.workspace__document {
  flex: none;
  padding: var(--space-4) var(--space-4) var(--space-3);
}

.workspace__document-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: var(--control-h-m);
}

/* 文档名看起来是一行标题；hover 提示可以编辑，编辑时才出现输入框的样子。 */
.workspace__title {
  flex: 1;
  min-width: 0;
  height: var(--control-h-m);
  box-sizing: border-box;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-l);
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  transition: background-color var(--duration-fast) var(--ease-out);
}

.workspace__title:hover {
  background: var(--color-fill-hover);
}

.workspace__title:focus {
  outline: none;
  background: var(--color-bg);
  box-shadow: 0 0 0 1px var(--color-control-border), 0 0 0 3px var(--color-accent-fill-strong);
}

.workspace__save-status {
  padding: 0 var(--space-3);
}

.workspace__icon-button {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--control-h-m);
  height: var(--control-h-m);
  padding: 0;
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: var(--color-text-tertiary);
}

.workspace__icon-button:hover,
.workspace__icon-button[aria-expanded='true'] {
  background: var(--color-fill-hover);
  color: var(--color-text-secondary);
}

.workspace__chapters {
  flex: 1;
  min-height: 0;
}

/* 分隔线本身是 1px 的边框；可拖动区域更宽，悬停或拖动时以强调色显示。 */
.workspace__resizer {
  position: absolute;
  top: 0;
  right: -4px;
  bottom: 0;
  z-index: 5;
  width: 7px;
  cursor: col-resize;
}

.workspace__resizer::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  content: '';
  background: transparent;
  transition: background-color var(--duration-base) var(--ease-out);
}

.workspace__resizer:hover::after,
.workspace--resizing .workspace__resizer::after {
  background: var(--color-accent);
  transition-delay: 120ms;
}

.workspace__resizer:focus-visible {
  outline: none;
}

.workspace__resizer:focus-visible::after {
  left: 2px;
  width: 3px;
  background: var(--color-focus-ring);
}

.workspace__main {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: var(--color-bg);
}

/* 顶栏：与正文同底色，没有边框；正文滚动离开顶部后才出现分隔线。 */
.workspace__bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-5);
  height: var(--header-h);
  padding: 0 var(--space-4);
  box-shadow: 0 1px 0 transparent;
  transition: box-shadow var(--duration-base) var(--ease-out);
  -webkit-user-select: none;
  user-select: none;
}

.workspace__bar--scrolled {
  box-shadow: 0 1px 0 var(--color-separator);
}

.workspace__tools {
  display: flex;
  flex: 1;
  min-width: 0;
}

.workspace__tools > * {
  flex: 1;
}

.workspace__mode {
  padding: 0 var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--text-m);
  font-weight: var(--weight-medium);
}

.workspace__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
}

.workspace__anchor {
  position: relative;
}

/* 文档级操作是无边框的文字按钮：可读、可发现，但不与正文争夺注意力。 */
.workspace__action {
  height: var(--control-h-m);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--text-m);
  white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.workspace__action:hover:not(:disabled),
.workspace__action--open {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.workspace__action:active:not(:disabled) {
  background: var(--color-fill-pressed);
}

.workspace__action--on,
.workspace__action--on:hover:not(:disabled) {
  background: var(--color-accent-fill);
  color: var(--color-accent-text);
}

.workspace__action:disabled {
  color: var(--color-text-tertiary);
}

.workspace__popover {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  z-index: calc(var(--z-popover) + 1);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-popover);
  outline: none;
  animation: workspace-popover-in var(--duration-fast) var(--ease-out);
}

@keyframes workspace-popover-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
}

.workspace__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.workspace__content {
  flex: 1;
  min-height: 0;
}

.workspace__preview {
  height: 100%;
  overflow-y: auto;
}

.workspace__preview-error {
  max-width: var(--doc-column);
  box-sizing: border-box;
  margin: var(--space-6) auto 0;
  padding: 0 var(--doc-gutter);
  color: var(--color-danger-text);
  font-size: var(--text-m);
}

.workspace__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding-bottom: var(--header-h);
  box-sizing: border-box;
  color: var(--color-text-tertiary);
  font-size: var(--text-l);
}

.workspace__placeholder p {
  margin: 0;
}

.workspace__toasts {
  position: absolute;
  right: 0;
  bottom: var(--space-6);
  left: 0;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: 0 var(--space-6);
  pointer-events: none;
}
</style>
