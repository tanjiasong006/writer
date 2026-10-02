<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Appearance } from '../../application/desktop_shell.ts'
import type { ProjectSession } from '../../application/project_session.ts'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { findChapter } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { hasContent } from '../../domain/document/document.ts'
import type { PdfLayoutSettings } from '../../domain/pdf_layout/pdf_layout.ts'
import { createPdfPreview, exportDocument } from '../../application/document_output.ts'
import ChapterManager from '../chapter_tree/ChapterManager.vue'
import SaveStatus from './SaveStatus.vue'
import DocumentInfoDialog from './DocumentInfoDialog.vue'
import PdfLayoutDialog from './PdfLayoutDialog.vue'
import DocumentTitle from './DocumentTitle.vue'
import ChapterEditor, { type ChapterRefRequest } from '../editor/ChapterEditor.vue'
import ChapterRefPicker from '../editor/ChapterRefPicker.vue'
import { chapterRefAddress, type ChapterRefShow } from '../../domain/chapter_reference/chapter_reference.ts'
import { useChapterJumps } from './use_chapter_jumps.ts'
import ChapterRefReportDialog from './ChapterRefReportDialog.vue'
import { countRefsTo, updateChapterRefs, type BrokenChapterRef, type ChapterRefUpdate } from '../editor/chapter_ref_update.ts'
import DocumentReader, { type ReadingPosition } from '../reader/DocumentReader.vue'
import { useServices } from '../services.ts'
import { useSession } from './use_session.ts'
import { useUiState } from './use_ui_state.ts'
import { useSidebar, SIDEBAR_DEFAULT, SIDEBAR_MIN } from './use_sidebar.ts'
import { useExport } from './use_export.ts'
import { useFocusRegion } from './use_focus_region.ts'
import { messageForStorageFailure } from './storage_messages.ts'
import { appendImage } from '../editor/markdown.ts'
import { chapterRefLabels } from '../editor/chapter_ref_view.ts'
import type { CommandState, EditorCommand } from '../editor/commands.ts'
import PopupMenu, { type MenuAnchor, type MenuEntry } from '../common/PopupMenu.vue'
import Toast from '../common/Toast.vue'
import Icon from '../common/Icon.vue'
import { useMenu } from '../common/use_menu.ts'
import { IS_MAC, SHORTCUTS, isHandled } from '../common/shortcuts.ts'
import { menuItemForKey, parseMenuItemId, workspaceMenus, type MenuCommand } from './app_menu.ts'

/**
 * 已打开项目的工作区。
 *
 * - 左侧栏：章节树；宽度可拖动调整，可以隐藏（显示 → 隐藏侧栏，或把分隔线拖到最窄处以外）。
 * - 右侧：一行工具栏 + 正文编辑器或全文阅读。工具栏开头是文档名（点击打开文档菜单），
 *   右边只放高频操作：插入表格 / 图片，以及全文阅读、导出。其余命令在菜单栏、右键菜单与快捷键中。
 * - 全文阅读盖在编辑器之上，编辑器保持挂载（各章节的撤销历史仍在）；阅读中滚动到的章节成为当前章节，
 *   回到编辑时停在读到的位置。
 * - unified 窗口（macOS）：工具栏与标题栏合为一体，窗口按钮浮在侧栏左上角，工具栏空白处可以拖动窗口。
 * - 菜单栏与快捷键来自同一份菜单（app_menu.ts），可用状态随焦点所在区域变化。
 * - 两侧独立滚动（ui-spec §27）。提示浮在正文区底部，不挤压布局。文档修改一律经 ProjectSession。
 *
 * 各项相对独立的职责在同目录的 use_*.ts 中（界面状态、侧栏、导出、焦点区域），
 * 这里负责把它们与菜单命令、章节树、编辑器连接起来。
 */
const props = defineProps<{
  session: ProjectSession
  /** 应用层的提示（如打开项目时的说明），与工作区自己的提示显示在同一处。 */
  notice?: string | null
  appearance: Appearance
}>()

const emit = defineEmits<{
  'new-project': []
  'open-project': []
  'dismiss-notice': []
  'set-appearance': [appearance: Appearance]
}>()

const { shell, output } = useServices()
const { document, status, lastError } = useSession(props.session)
const unified = shell.windowStyle === 'unified'

/** 工作区内操作（如插入图片、导出）的错误说明；不属于保存状态。 */
const actionError = ref<string | null>(null)
const editor = ref<InstanceType<typeof ChapterEditor> | null>(null)
const chapters = ref<InstanceType<typeof ChapterManager> | null>(null)
const documentTitle = ref<InstanceType<typeof DocumentTitle> | null>(null)
/** 文档信息对话框是否打开。 */
const editingInfo = ref(false)
/** PDF 排版设置：从导出 PDF 进入时完成后继续导出；从菜单进入时只保存设置。 */
const layoutDialog = ref<'export' | 'save' | null>(null)
/** 排版设置中的样张：打开设置时捕获一次当前内容（对话框是模态的，期间内容不变）。 */
const layoutPreview = computed(() =>
  layoutDialog.value ? createPdfPreview(output, props.session.path, document.value) : null,
)
const reader = ref<InstanceType<typeof DocumentReader> | null>(null)

const { selectedId, collapsedIds } = useUiState(shell, props.session.path, () => document.value.tree)

const {
  element: sidebarElement,
  visible: sidebarVisible,
  width: sidebarWidth,
  maxWidth: sidebarMax,
  resizing,
  setWidth: setSidebarWidth,
  setVisible: setSidebarVisible,
  startResize,
  onResizeKey,
} = useSidebar(shell, () => editor.value?.focus())

const focusRegion = useFocusRegion()

/** 窗口标题显示当前文档名（窗口菜单、调度中心中可见）；离开工作区时恢复为应用名。 */
watch(
  () => document.value.title,
  (title) => shell.setWindowTitle(`${title.trim() || '未命名文档'} — ${shell.appName}`),
  { immediate: true },
)
onBeforeUnmount(() => shell.setWindowTitle(shell.appName))

const {
  exporting,
  notice: exportNotice,
  exportAs,
} = useExport({
  shell,
  title: () => document.value.title,
  run: (format, target) =>
    exportDocument(output, props.session.path, document.value, props.session.pdfLayout, format, target),
  onError: (message) => (actionError.value = message),
})

/** 工具栏按钮菜单（文档菜单、导出）与它们的界面绘制版本（没有系统菜单时）。 */
const menu = useMenu()
/** 打开着菜单的工具栏按钮：按钮保持按下的样子。 */
const openMenuButton = ref<'title' | 'export' | null>(null)

async function showButtonMenu(
  button: 'title' | 'export',
  entries: readonly MenuEntry[],
  anchor: MenuAnchor,
  keyboard: boolean,
): Promise<string | null> {
  openMenuButton.value = button
  const chosen = await menu.open(entries, anchor, keyboard)
  if (openMenuButton.value === button) openMenuButton.value = null
  return chosen
}

const EXPORT_ITEMS: readonly MenuEntry[] = [
  { id: 'docx', label: '导出为 Word（.docx）…' },
  { id: 'pdf', label: '导出为 PDF…' },
]

async function openExportMenu(event: MouseEvent): Promise<void> {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const chosen = await showButtonMenu('export', EXPORT_ITEMS, { rect, align: 'end' }, event.detail === 0)
  if (chosen === 'docx') void exportAs('docx')
  else if (chosen === 'pdf') {
    // 等菜单关闭、焦点回到导出按钮后再打开：对话框关闭时把焦点还到这里。
    await nextTick()
    layoutDialog.value = 'export'
  }
}

/** PDF 排版设置完成：保存设置；从导出 PDF 进入时接着选择保存位置并导出。 */
function finishLayout(settings: PdfLayoutSettings): void {
  const action = layoutDialog.value
  props.session.setPdfLayout(settings)
  layoutDialog.value = null
  if (action === 'export') void exportAs('pdf')
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
  // 图注为空，不用文件名代替（图注会出现在导出中），需要时由作者添加。
  const { reference } = result.value
  if (editor.value?.insertImage(chapterId, reference, '')) return
  // 选择文件期间切换了章节：追加到发起请求的章节末尾，不插错位置。
  const text = props.session.document.contents.get(chapterId)
  if (text !== undefined) props.session.setContent(chapterId, appendImage(text, reference, ''))
}

/** 正文中的图片引用 → 编辑器中可显示的地址（只显示项目内的文件）。 */
function resolveImage(reference: string): string | null {
  const path = props.session.assetPath(reference)
  return path === null ? null : shell.toDisplayUrl(path)
}

/** 全文阅读（docs/decisions.md 第 8 节）：编辑环境中的连续只读展示，不是导出效果预览。 */
const reading = ref(false)
/** 进入阅读时的位置：编辑器中正在看的地方。 */
const readingStart = shallowRef<ReadingPosition | null>(null)

function openReading(): void {
  if (reading.value || tree.value.length === 0) return
  const id = selectedId.value
  readingStart.value = id !== null && editor.value ? { chapterId: id, ...editor.value.readingPosition() } : null
  reading.value = true
}

/** 回到编辑：在读到的章节、读到的位置继续写。 */
async function closeReading(position: ReadingPosition | null): Promise<void> {
  if (!reading.value) return
  if (position && position.chapterId !== selectedId.value) selectedId.value = position.chapterId
  reading.value = false
  await nextTick()
  if (position) editor.value?.revealPosition(position)
  editor.value?.focus()
}

function toggleReading(): void {
  if (reading.value) void closeReading(reader.value?.position() ?? null)
  else openReading()
}

/** 章节树中按 Enter：把焦点交给正文编辑器（全文阅读中则回到编辑）。 */
async function openChapter(): Promise<void> {
  if (reading.value) {
    await closeReading(reader.value?.position() ?? null)
    return
  }
  await nextTick()
  editor.value?.focus()
}

/** 进入章节树（⌘J）：侧栏隐藏时先显示，焦点落在当前章节上。 */
async function focusTree(): Promise<void> {
  if (!sidebarVisible.value) await setSidebarVisible(true)
  await nextTick()
  chapters.value?.focusCurrent()
}

/** ⌘J：在章节树与正文（全文阅读中是阅读区）之间切换；焦点在其他位置（如工具栏）时进入章节树。 */
function switchFocus(): void {
  if (focusRegion.value === 'tree' && reading.value) reader.value?.focus()
  else if (focusRegion.value === 'tree') void openChapter()
  else void focusTree()
}

function chapterHasContent(chapterId: ChapterId): boolean {
  return hasContent(document.value, chapterId)
}

/**
 * 只依赖章节树：编辑正文不改变树的引用，computed 值不变时不会触发下游重算，
 * 输入时不必为每次按键重新计算整棵树的编号。
 */
const tree = computed(() => document.value.tree)
const numbers = computed(() => computeChapterNumbers(tree.value))
/** 章节引用的文字：随章节树变化，编辑正文时不变。 */
const refLabel = computed(() => chapterRefLabels(tree.value))

/** 选择章节引用的目标：发起请求的章节与位置（docs/decisions.md 第 9 节）。 */
const refPicker = shallowRef<{ readonly chapterId: ChapterId; readonly request: ChapterRefRequest } | null>(null)

function requestChapterRef(chapterId: ChapterId, request: ChapterRefRequest): void {
  refPicker.value = { chapterId, request }
}

function pickChapterRef(id: ChapterId, show: ChapterRefShow): void {
  const picker = refPicker.value
  refPicker.value = null
  if (picker && editor.value?.insertChapterRef(picker.chapterId, chapterRefAddress(id, show))) return
  editor.value?.focus()
}

function cancelChapterRef(): void {
  refPicker.value = null
  editor.value?.focus()
}

/** 章节完整的名称（编号 + 标题），用于提示。 */
function chapterName(id: ChapterId): string {
  const title = findChapter(tree.value, id)?.title || '未命名章节'
  return `${(numbers.value.get(id) ?? []).join('.')} ${title}`
}

/** 更新交叉引用的结果（对话框）。 */
const refReport = shallowRef<ChapterRefUpdate | null>(null)

/** 章节 id，按阅读顺序（与导出相同）。 */
function readingOrder(): ChapterId[] {
  const ids: ChapterId[] = []
  const visit = (nodes: typeof tree.value): void => {
    for (const node of nodes) {
      ids.push(node.id)
      visit(node.children)
    }
  }
  visit(tree.value)
  return ids
}

/** 更新交叉引用：链接文字过期的章节写回（正常保存提交），编辑器状态不变；结果在对话框中说明。 */
function updateAllChapterRefs(): void {
  const result = updateChapterRefs(readingOrder(), document.value.contents, refLabel.value)
  for (const [chapterId, text] of result.texts) {
    editor.value?.adoptContent(chapterId, text)
    props.session.setContent(chapterId, text)
  }
  refReport.value = result
}

/** 从失效引用列表跳到它所在的位置。 */
async function showBrokenRef(item: BrokenChapterRef): Promise<void> {
  refReport.value = null
  selectedId.value = item.chapterId
  await nextTick()
  editor.value?.selectChapterRef(item.chapterId, item.index)
}

function closeRefReport(): void {
  refReport.value = null
  editor.value?.focus()
}

/** 删除章节时说明：其他章节中指向它（包括它的子章节）的引用数量。 */
function chapterRefCount(chapterId: ChapterId): number {
  const node = findChapter(tree.value, chapterId)
  if (!node) return 0
  const subtree = new Set<ChapterId>()
  const visit = (current: typeof node): void => {
    subtree.add(current.id)
    current.children.forEach(visit)
  }
  visit(node)
  return countRefsTo(document.value.contents, subtree, (id) => !subtree.has(id))
}

const jumps = useChapterJumps({
  selectedId,
  exists: (id) => findChapter(tree.value, id) !== null,
  name: chapterName,
  revealStart: (id) => editor.value?.revealStart(id),
  focus: () => editor.value?.focus(),
})

const selectedChapter = computed(() =>
  selectedId.value === null ? null : findChapter(tree.value, selectedId.value),
)

const selectedNumber = computed(() =>
  selectedId.value === null ? '' : (numbers.value.get(selectedId.value) ?? []).join('.'),
)

/** 所有章节都被删除后没有可读的内容。 */
watch(
  () => tree.value.length === 0,
  (empty) => {
    if (empty) reading.value = false
  },
)

/** 文档名：重命名、文档信息、新建 / 打开其他文档、在访达中显示项目文件夹。 */
const TITLE_ITEMS: readonly MenuEntry[] = [
  { id: 'rename', label: '重命名' },
  { id: 'info', label: '文档信息…' },
  { separator: true },
  { id: 'new', label: '新建文档…', shortcut: SHORTCUTS.newDocument },
  { id: 'open', label: '打开文档…', shortcut: SHORTCUTS.openDocument },
  { separator: true },
  { id: 'reveal', label: IS_MAC ? '在访达中显示' : '在文件夹中显示' },
]

async function openTitleMenu(rect: DOMRect, keyboard: boolean): Promise<void> {
  const chosen = await showButtonMenu('title', TITLE_ITEMS, { rect, align: 'start' }, keyboard)
  if (chosen === 'rename') void documentTitle.value?.startRename()
  else if (chosen === 'info') {
    // 等菜单关闭、焦点回到文档名后再打开：对话框关闭时把焦点还到这里。
    await nextTick()
    editingInfo.value = true
  }
  else if (chosen === 'new') emit('new-project')
  else if (chosen === 'open') emit('open-project')
  else if (chosen === 'reveal') void shell.revealFile(props.session.path)
}

/** 编辑器报告的命令状态（工具栏与菜单栏据此显示可用 / 勾选状态）。 */
const tools = shallowRef<CommandState | null>(null)

function showTools(state: CommandState): void {
  tools.value = state
}

/** 没有章节时编辑器不存在，它报告的状态随之失效。 */
watch(selectedChapter, (chapter) => {
  if (!chapter) tools.value = null
})

function runCommand(command: EditorCommand): void {
  editor.value?.runCommand(command)
}

/** 正文滚动离开顶部后，工具栏下方出现一条分隔线，说明内容在它下面继续。 */
const scrolled = ref(false)

function onMainScroll(event: Event): void {
  const target = event.target as HTMLElement
  if (target.classList?.contains('chapter-editor__scroller') || target.classList?.contains('document-reader')) {
    scrolled.value = target.scrollTop > 0
  }
}

const NO_MOVES = { up: false, down: false, outdent: false, indent: false } as const

const menus = computed(() =>
  workspaceMenus({
    focus: focusRegion.value,
    tools: selectedChapter.value ? tools.value : null,
    hasSelectedChapter: selectedChapter.value !== null,
    // 依赖 tree 与 selectedId：结构或选中章节变化时重新计算。
    moves:
      selectedChapter.value && chapters.value && tree.value
        ? {
            up: chapters.value.canMove('up'),
            down: chapters.value.canMove('down'),
            outdent: chapters.value.canMove('outdent'),
            indent: chapters.value.canMove('indent'),
          }
        : NO_MOVES,
    sidebarVisible: sidebarVisible.value,
    exporting: exporting.value !== null,
    hasChapters: tree.value.length > 0,
    reading: reading.value,
    canGoBack: jumps.canGoBack.value,
    canGoForward: jumps.canGoForward.value,
    appearance: props.appearance,
  }),
)

watch(menus, (next) => shell.setAppMenu?.(next, runMenuItem), { immediate: true })

/** 执行菜单栏（或它的快捷键）中的一项。 */
function runMenuItem(id: string): void {
  const command = parseMenuItemId(id)
  if (command !== null) void runMenuCommand(command)
}

async function runMenuCommand(command: MenuCommand): Promise<void> {
  switch (command.group) {
    case 'editor':
      runCommand(command.command)
      return
    case 'file':
      switch (command.action) {
        case 'new':
          emit('new-project')
          return
        case 'open':
          emit('open-project')
          return
        case 'rename':
          void documentTitle.value?.startRename()
          return
        case 'info':
          editingInfo.value = true
          return
        case 'reveal':
          void shell.revealFile(props.session.path)
          return
        case 'save':
          void props.session.save()
          return
        case 'export-docx':
          void exportAs('docx')
          return
        case 'export-pdf':
          layoutDialog.value = 'export'
          return
        case 'pdf-layout':
          layoutDialog.value = 'save'
          return
      }
      return
    case 'edit':
      if (command.action === 'list-menu') {
        if (focusRegion.value === 'editor') void editor.value?.openListMenu()
      } else if (command.action === 'context-menu') {
        if (focusRegion.value === 'tree') chapters.value?.openChapterMenu()
        else void editor.value?.openMenuAtCaret()
      } else if (focusRegion.value === 'editor') {
        // 正文有自己的撤销历史；普通输入框交给浏览器。
        runCommand(command.action)
      } else {
        globalThis.document.execCommand(command.action)
      }
      return
    case 'view':
      if (command.action === 'sidebar') void setSidebarVisible(!sidebarVisible.value)
      else if (command.action === 'reader') toggleReading()
      else if (command.action === 'back') void jumps.back()
      else if (command.action === 'forward') void jumps.forward()
      else switchFocus()
      return
    case 'insert':
      updateAllChapterRefs()
      return
    case 'appearance':
      emit('set-appearance', command.appearance)
      return
    case 'chapter':
    case 'move-chapter': {
      // 章节命令作用于侧栏中的章节：侧栏隐藏时先显示出来，新建与重命名才看得见。
      const isDelete = command.group === 'chapter' && command.action === 'delete'
      if (!sidebarVisible.value && !isDelete) await setSidebarVisible(true)
      const manager = chapters.value
      if (!manager) return
      if (command.group === 'move-chapter') {
        manager.moveChapter(command.direction)
        return
      }
      switch (command.action) {
        case 'new':
          manager.createChapter()
          return
        case 'new-child':
          manager.createChildChapter()
          return
        case 'rename':
          manager.renameChapter()
          return
        case 'delete':
          manager.deleteChapter()
          return
      }
    }
  }
}

/**
 * 快捷键：按菜单栏中的同一份快捷键执行。已被焦点处（正文、章节树、输入框）处理的按键不再处理；
 * macOS 上系统菜单栏会先于或代替这里响应，同一次按键只执行一次。
 */
function onKeydown(event: KeyboardEvent): void {
  if (isHandled(event)) return
  const id = menuItemForKey(menus.value, event)
  if (id !== null) {
    event.preventDefault()
    runMenuItem(id)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/**
 * 保存失败的完整原因以提示条给出；关闭后工具栏中的"保存失败"仍在，下一次失败（原因可能不同）再次显示。
 */
const saveErrorDismissed = ref(false)
watch(lastError, () => (saveErrorDismissed.value = false))

/** 没有章节时正文区的主要操作：新建第一个章节（与侧栏中的按钮相同）。 */
async function createFirstChapter(): Promise<void> {
  if (!sidebarVisible.value) await setSidebarVisible(true)
  chapters.value?.createChapter()
}
</script>


<template>
  <div
    class="workspace"
    :class="{
      'workspace--unified': unified,
      'workspace--resizing': resizing,
      'workspace--sidebar-hidden': !sidebarVisible,
    }"
    :style="{ '--sidebar-w': `${sidebarWidth}px` }"
    :data-save-status="status"
  >
    <aside v-show="sidebarVisible" ref="sidebarElement" class="workspace__sidebar" aria-label="文档结构">
      <!-- unified 窗口：侧栏顶部是标题栏的一部分，左边是窗口按钮，右边是侧栏开关。 -->
      <div v-if="unified" class="workspace__sidebar-bar" data-tauri-drag-region>
        <button
          type="button"
          class="workspace__tool"
          tabindex="0"
          aria-label="隐藏侧栏"
          title="隐藏侧栏"
          @click="setSidebarVisible(false)"
        >
          <Icon name="sidebar" />
        </button>
      </div>

      <ChapterManager
        ref="chapters"
        v-model:selected-id="selectedId"
        v-model:collapsed-ids="collapsedIds"
        class="workspace__chapters"
        :tree="document.tree"
        :has-content="chapterHasContent"
        :reference-count="chapterRefCount"
        @update:tree="session.applyTree($event)"
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
      <header class="workspace__bar" :class="{ 'workspace__bar--scrolled': scrolled }" data-tauri-drag-region>
        <button
          v-if="!sidebarVisible || !unified"
          type="button"
          class="workspace__tool"
          tabindex="0"
          :aria-label="sidebarVisible ? '隐藏侧栏' : '显示侧栏'"
          :aria-pressed="sidebarVisible"
          :title="sidebarVisible ? '隐藏侧栏' : '显示侧栏'"
          @click="setSidebarVisible(!sidebarVisible)"
        >
          <Icon name="sidebar" />
        </button>

        <DocumentTitle
          ref="documentTitle"
          class="workspace__title"
          :class="{ 'workspace__title--open': openMenuButton === 'title' }"
          :title="document.title"
          @menu="openTitleMenu"
          @rename="session.setTitle($event)"
        />
        <SaveStatus
          v-if="status === 'failed'"
          class="workspace__save-status"
          :status="status"
          :error="lastError"
          @retry="session.save()"
        />

        <div class="workspace__spacer" data-tauri-drag-region></div>

        <div v-if="selectedChapter && !reading" class="workspace__group" role="toolbar" aria-label="插入">
          <button
            type="button"
            class="workspace__tool"
            tabindex="0"
            aria-label="插入表格"
            title="插入表格"
            :disabled="tools !== null && !tools.table.enabled"
            @mousedown.prevent
            @click="runCommand('table')"
          >
            <Icon name="table" />
          </button>
          <button
            type="button"
            class="workspace__tool"
            tabindex="0"
            aria-label="插入图片"
            title="插入图片…"
            :disabled="tools !== null && !tools.image.enabled"
            @mousedown.prevent
            @click="runCommand('image')"
          >
            <Icon name="image" />
          </button>
        </div>

        <div class="workspace__group" role="toolbar" aria-label="文档">
          <button
            type="button"
            class="workspace__tool"
            tabindex="0"
            :class="{ 'workspace__tool--on': reading }"
            aria-label="全文阅读"
            :aria-pressed="reading"
            :disabled="document.tree.length === 0"
            :title="reading ? '回到编辑（Esc）' : '全文阅读'"
            @click="toggleReading"
          >
            <Icon name="reader" />
          </button>
          <button
            type="button"
            class="workspace__tool"
            tabindex="0"
            :class="{ 'workspace__tool--open': openMenuButton === 'export', 'workspace__tool--busy': exporting }"
            aria-label="导出"
            aria-haspopup="menu"
            :aria-expanded="openMenuButton === 'export'"
            :disabled="exporting !== null"
            :title="exporting ? '正在导出…' : '导出为 Word 或 PDF'"
            @click="openExportMenu"
          >
            <Icon name="export" />
          </button>
        </div>
      </header>

      <div class="workspace__content">
        <ChapterEditor
          v-if="selectedChapter && selectedId !== null"
          ref="editor"
          :inert="reading || undefined"
          :chapter-id="selectedId"
          :content="document.contents.get(selectedId) ?? ''"
          :number="selectedNumber"
          :title="selectedChapter.title"
          :resolve-image="resolveImage"
          :ref-label="refLabel"
          @change="(chapterId, text) => session.setContent(chapterId, text)"
          @request-image="insertImage"
          @request-chapter-ref="requestChapterRef"
          @open-chapter="jumps.jump"
          @tools="showTools"
        />
        <div v-else class="workspace__placeholder" :inert="reading || undefined">
          <template v-if="document.tree.length === 0">
            <p>这份文档还没有章节。</p>
            <!-- 侧栏中已有"新建第一个章节"；侧栏隐藏时才在这里给出同样的操作。 -->
            <button v-if="!sidebarVisible" type="button" class="workspace__placeholder-action" tabindex="0" @click="createFirstChapter">
              新建章节
            </button>
          </template>
          <p v-else>在左侧选择一个章节，开始写作。</p>
        </div>
        <DocumentReader
          v-if="reading"
          ref="reader"
          class="workspace__reader"
          :tree="document.tree"
          :contents="document.contents"
          :active-chapter-id="selectedId"
          :resolve-image="resolveImage"
          :initial-position="readingStart"
          @select="selectedId = $event"
          @exit="closeReading"
        />
      </div>

      <div class="workspace__toasts">
        <Toast v-if="notice" class="app__notice" @dismiss="emit('dismiss-notice')">{{ notice }}</Toast>
        <Toast
          v-if="status === 'failed' && lastError && !saveErrorDismissed"
          class="workspace__save-error"
          tone="error"
          @dismiss="saveErrorDismissed = true"
        >
          {{ messageForStorageFailure(lastError) }} 修改仍在，稍后会自动再试。
          <template #actions>
            <button type="button" @click="session.save()">重试</button>
          </template>
        </Toast>
        <Toast v-if="actionError" class="workspace__error" tone="error" @dismiss="actionError = null">
          {{ actionError }}
        </Toast>
        <Toast v-if="jumps.notice.value" class="workspace__jump" @dismiss="jumps.dismiss">
          {{ jumps.notice.value }}
          <template #actions>
            <button type="button" @click="jumps.back">返回</button>
          </template>
        </Toast>
        <Toast v-if="exportNotice" class="workspace__notice" @dismiss="exportNotice = null">
          {{ exportNotice.message }}
          <template #actions>
            <button type="button" @click="shell.revealFile(exportNotice.path)">
              {{ IS_MAC ? '在访达中显示' : '在文件夹中显示' }}
            </button>
          </template>
        </Toast>
      </div>
    </main>

    <ChapterRefReportDialog
      v-if="refReport"
      :chapters="refReport.texts.size"
      :updated="refReport.updated"
      :broken="refReport.broken"
      :chapter-name="chapterName"
      @select="showBrokenRef"
      @close="closeRefReport"
    />

    <ChapterRefPicker
      v-if="refPicker"
      :tree="tree"
      :anchor="refPicker.request.anchor"
      :current="refPicker.request.current"
      @pick="pickChapterRef"
      @cancel="cancelChapterRef"
    />

    <PopupMenu
      v-if="menu.current.value"
      label="菜单"
      backdrop-class="workspace__backdrop"
      :items="menu.current.value.entries"
      :anchor="menu.current.value.anchor"
      :keyboard="menu.current.value.keyboard"
      @select="menu.select"
      @close="menu.close"
    />

    <PdfLayoutDialog
      v-if="layoutDialog && layoutPreview"
      :settings="session.pdfLayout"
      :action="layoutDialog"
      :preview="layoutPreview"
      @submit="finishLayout"
      @cancel="layoutDialog = null"
    />

    <DocumentInfoDialog
      v-if="editingInfo"
      :info="document"
      @submit="session.setDocumentInfo($event); editingInfo = false"
      @cancel="editingInfo = false"
    />
  </div>
</template>

<style scoped>
.workspace {
  --toolbar-h: var(--header-h);
  display: flex;
  height: 100vh;
}

/* macOS 合一的标题栏与工具栏：52pt，窗口按钮在侧栏顶部垂直居中。 */
.workspace--unified {
  --toolbar-h: var(--toolbar-h-unified);
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

/* 普通标题栏：章节树的标题行与右侧工具栏垂直居中对齐。 */
.workspace:not(.workspace--unified) .workspace__sidebar {
  padding-top: calc((var(--toolbar-h) - var(--tree-row-h)) / 2);
}

.workspace__sidebar-bar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  height: var(--toolbar-h);
  padding: 0 var(--space-4);
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

/* 工具栏：与正文同底色，没有边框；正文滚动离开顶部后才出现分隔线。 */
.workspace__bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  height: var(--toolbar-h);
  box-sizing: border-box;
  padding: 0 var(--space-4) 0 var(--space-5);
  box-shadow: 0 1px 0 transparent;
  transition: box-shadow var(--duration-base) var(--ease-out);
  -webkit-user-select: none;
  user-select: none;
}

/* 侧栏隐藏时工具栏延伸到窗口左边缘：为窗口按钮留出位置。 */
.workspace--unified.workspace--sidebar-hidden .workspace__bar {
  padding-left: var(--traffic-lights-w);
}

.workspace__bar--scrolled {
  box-shadow: 0 1px 0 var(--color-separator);
}

.workspace__title {
  flex: 0 1 auto;
  min-width: 0;
}

.workspace__title--open :deep(.document-title__button) {
  background: var(--color-fill-hover);
}

.workspace__save-status {
  flex: none;
  margin-left: var(--space-2);
}

.workspace__spacer {
  flex: 1;
  align-self: stretch;
  min-width: var(--space-5);
}

.workspace__group {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
}

/* 两组按钮之间留出比组内更大的间距，不用分隔线。 */
.workspace__group + .workspace__group {
  margin-left: var(--space-5);
}

/* 工具栏按钮：无边框的图标按钮，默认次级前景色；hover 出现浅底，打开时保持按下的样子。 */
.workspace__tool {
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
  color: var(--color-text-secondary);
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.workspace__tool:hover:not(:disabled),
.workspace__tool--open {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.workspace__tool:active:not(:disabled) {
  background: var(--color-fill-pressed);
}

.workspace__tool--on,
.workspace__tool--on:hover:not(:disabled) {
  background: var(--color-accent-fill);
  color: var(--color-accent-text);
}

.workspace__tool:disabled {
  color: var(--color-text-disabled);
}

/* 导出进行中：按钮不可用，图标缓慢闪动说明正在工作。 */
.workspace__tool--busy .icon {
  animation: workspace-busy 1.2s ease-in-out infinite;
}

@keyframes workspace-busy {
  50% {
    opacity: 0.35;
  }
}

.workspace__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.workspace__content {
  position: relative;
  flex: 1;
  min-height: 0;
}

/* 全文阅读盖住编辑器（编辑器仍在下面，保持各章节的撤销历史）。 */
.workspace__reader {
  position: absolute;
  inset: 0;
}

/* 没有打开章节：一句说明 + 主要操作，垂直居中在正文区（扣除工具栏高度，视觉上居中）。 */
.workspace__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
  height: 100%;
  padding-bottom: var(--toolbar-h);
  box-sizing: border-box;
  color: var(--color-text-tertiary);
  font-size: var(--text-l);
}

.workspace__placeholder p {
  margin: 0;
}

.workspace__placeholder-action {
  height: var(--control-h-m);
  padding: 0 var(--space-6);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  box-shadow: inset 0 0 0 1px var(--color-separator);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-m);
  font-weight: var(--weight-medium);
}

.workspace__placeholder-action:hover {
  background: var(--color-fill-pressed);
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
