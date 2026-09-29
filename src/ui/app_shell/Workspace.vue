<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ProjectSession } from '../../application/project_session.ts'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { findChapter } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { hasContent } from '../../domain/document/document.ts'
import type { KeyboardMoveDirection } from '../../application/move_chapter.ts'
import ChapterManager from '../chapter_tree/ChapterManager.vue'
import SaveStatus from './SaveStatus.vue'
import DocumentTitle from './DocumentTitle.vue'
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
import type { CommandState, EditorCommand } from '../editor/commands.ts'
import type { SelectedFigure } from '../editor/image_layout.ts'
import PopupMenu, { type MenuAnchor, type MenuEntry } from '../common/PopupMenu.vue'
import Toast from '../common/Toast.vue'
import Icon from '../common/Icon.vue'
import { useMenu } from '../common/use_menu.ts'
import { IS_MAC, SHORTCUTS } from '../common/shortcuts.ts'
import { menuItemForKey, workspaceMenus, type FocusRegion } from './app_menu.ts'
import {
  resolveTheme,
  type ImageOverride,
  type StyleOverrides,
  type ThemeId,
} from '../../domain/document_style/document_style.ts'

/**
 * 已打开项目的工作区。
 *
 * - 左侧栏：章节树；宽度可拖动调整，可以隐藏（显示 → 隐藏侧栏，或把分隔线拖到最窄处以外）。
 * - 右侧：一行工具栏 + 正文编辑器或全文预览。工具栏开头是文档名（点击打开文档菜单），
 *   右边只放高频操作：插入表格 / 图片，以及预览、文档样式、导出。其余命令在菜单栏、右键菜单与快捷键中。
 * - unified 窗口（macOS）：工具栏与标题栏合为一体，窗口按钮浮在侧栏左上角，工具栏空白处可以拖动窗口。
 * - 菜单栏与快捷键来自同一份菜单（app_menu.ts），可用状态随焦点所在区域变化。
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
const unified = shell.windowStyle === 'unified'

const selectedId = ref<ChapterId | null>(null)
/** 工作区内操作（如插入图片）的错误说明；不属于保存状态。 */
const actionError = ref<string | null>(null)
const editor = ref<InstanceType<typeof ChapterEditor> | null>(null)
const chapters = ref<InstanceType<typeof ChapterManager> | null>(null)
const documentTitle = ref<InstanceType<typeof DocumentTitle> | null>(null)
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

onBeforeUnmount(() => {
  if (uiStateTimer !== null) persistUiState()
})

/** 窗口标题显示当前文档名（窗口菜单、调度中心中可见）；离开工作区时恢复为应用名。 */
watch(
  () => document.value.title,
  (title) => shell.setWindowTitle(`${title.trim() || '未命名文档'} — ${shell.appName}`),
  { immediate: true },
)
onBeforeUnmount(() => shell.setWindowTitle(shell.appName))

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
  if (chosen !== null) void exportAs(chosen as ExportFormat)
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
/** 正在导出的格式；导出期间禁用导出，避免重复写同一文件。 */
const exporting = ref<ExportFormat | null>(null)
const exportNotice = ref<{ readonly message: string; readonly path: string } | null>(null)

/** 文件名中不允许的字符替换为 -，空标题使用默认名。 */
function exportBaseName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
  return name.length > 0 ? name : '未命名文档'
}

async function exportAs(format: ExportFormat): Promise<void> {
  if (exporting.value !== null) return
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

/** 文档名：重命名、新建 / 打开其他文档、在访达中显示项目文件夹。 */
const TITLE_ITEMS: readonly MenuEntry[] = [
  { id: 'rename', label: '重命名' },
  { separator: true },
  { id: 'new', label: '新建文档…', shortcut: SHORTCUTS.newDocument },
  { id: 'open', label: '打开文档…', shortcut: SHORTCUTS.openDocument },
  { separator: true },
  { id: 'reveal', label: IS_MAC ? '在访达中显示' : '在文件夹中显示' },
]

async function openTitleMenu(rect: DOMRect, keyboard: boolean): Promise<void> {
  const chosen = await showButtonMenu('title', TITLE_ITEMS, { rect, align: 'start' }, keyboard)
  if (chosen === 'rename') void documentTitle.value?.startRename()
  else if (chosen === 'new') emit('new-project')
  else if (chosen === 'open') emit('open-project')
  else if (chosen === 'reveal') void shell.revealFile(props.session.path)
}

function renameDocument(title: string): void {
  props.session.setTitle(title)
}

/**
 * 文档样式（整本书的设置，不属于正文工具栏）。与 tree 一样只依赖样式对象：
 * 编辑正文时样式引用不变，主题不会重新解析，编辑器与预览的样式也不会重算。
 */
const documentStyle = computed(() => document.value.style)
const theme = computed(() => resolveTheme(documentStyle.value))
const stylePanelOpen = ref(false)
const styleButton = ref<HTMLButtonElement | null>(null)
const stylePanel = ref<HTMLElement | null>(null)
/** 打开样式面板前的焦点：关闭后回到那里（从菜单栏打开时通常是正文）。 */
let focusBeforeStyle: HTMLElement | null = null

async function openStylePanel(): Promise<void> {
  if (stylePanelOpen.value) return
  // 从系统菜单栏打开时，网页中可能暂时没有获得焦点的元素（activeElement 是 body）：用最近一次获得焦点的元素。
  const active = globalThis.document.activeElement
  focusBeforeStyle = active instanceof HTMLElement && active !== globalThis.document.body ? active : lastFocused
  stylePanelOpen.value = true
  await nextTick()
  stylePanel.value?.focus({ preventScroll: true })
}

/**
 * 点击面板以外的地方关闭面板（"样式"按钮自己切换）。不用覆盖整个窗口的透明遮罩：
 * 面板打开时正文仍可以滚动，一边看效果一边调整；点击也照常作用于点到的地方（如在正文中放置光标）。
 */
function closeStylePanelOnOutsidePointer(event: PointerEvent): void {
  const target = event.target as globalThis.Node | null
  if (target && (stylePanel.value?.contains(target) || styleButton.value?.contains(target))) return
  closeStylePanel()
}

watch(stylePanelOpen, (open) => {
  if (open) globalThis.document.addEventListener('pointerdown', closeStylePanelOnOutsidePointer, true)
  else globalThis.document.removeEventListener('pointerdown', closeStylePanelOnOutsidePointer, true)
})
onBeforeUnmount(() => globalThis.document.removeEventListener('pointerdown', closeStylePanelOnOutsidePointer, true))

function toggleStylePanel(): void {
  if (stylePanelOpen.value) closeStylePanel()
  else void openStylePanel()
}

/** 用键盘关闭面板时焦点回到打开前的位置（没有时回到"样式"按钮）。 */
function closeStylePanel(event?: KeyboardEvent): void {
  event?.preventDefault()
  stylePanelOpen.value = false
  if (!event) return
  const target = focusBeforeStyle?.isConnected ? focusBeforeStyle : styleButton.value
  // 回到正文时经编辑器聚焦：光标与滚动位置保持原样。
  if (target?.closest('.chapter-editor__content')) editor.value?.focus()
  else target?.focus({ preventScroll: true })
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

/** 编辑器报告的命令状态与选中的图片（工具栏与菜单栏据此显示可用 / 勾选状态）。 */
const tools = shallowRef<CommandState | null>(null)
const figure = shallowRef<SelectedFigure | null>(null)

function showTools(state: CommandState, selected: SelectedFigure | null): void {
  tools.value = state
  figure.value = selected
}

/** 没有章节时编辑器不存在，它报告的状态随之失效。 */
watch(selectedChapter, (chapter) => {
  if (chapter) return
  tools.value = null
  figure.value = null
})

function runCommand(command: EditorCommand): void {
  editor.value?.runCommand(command)
}

/** 正文滚动离开顶部后，工具栏下方出现一条分隔线，说明内容在它下面继续。 */
const scrolled = ref(false)

function onMainScroll(event: Event): void {
  const target = event.target as HTMLElement
  if (target.classList?.contains('chapter-editor__scroller') || target.classList?.contains('workspace__preview')) {
    scrolled.value = target.scrollTop > 0
  }
}

/**
 * 侧栏宽度（ui-spec §31）：默认 260px，拖动分隔线在 180–480px 之间调整，双击恢复默认；
 * 同时保证正文区至少留出 MIN_MAIN 宽度。拖到比最窄处再窄一截松手时隐藏侧栏（macOS 侧栏的习惯）。
 * 宽度与是否显示是本机的界面偏好（应用级状态，见 DesktopShell），不随项目保存。
 */
const SIDEBAR_DEFAULT = 260
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480
const SIDEBAR_COLLAPSE = SIDEBAR_MIN - 60
const MIN_MAIN = 440
const SIDEBAR_KEY = 'sidebar-width'
const SIDEBAR_VISIBLE_KEY = 'sidebar-visible'

function storedSidebarWidth(): number {
  const value = Number(shell.getPreference(SIDEBAR_KEY))
  return Number.isFinite(value) && value > 0 ? value : SIDEBAR_DEFAULT
}

const sidebarPreferred = ref(storedSidebarWidth())
const sidebarVisible = ref(shell.getPreference(SIDEBAR_VISIBLE_KEY) !== 'false')
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
  shell.setPreference(SIDEBAR_KEY, String(Math.round(sidebarPreferred.value)))
}

/** 显示 / 隐藏侧栏。隐藏时焦点若在侧栏中，交给正文，不让焦点落到看不见的地方。 */
async function setSidebarVisible(visible: boolean): Promise<void> {
  const focusInSidebar = sidebar.value?.contains(globalThis.document.activeElement) ?? false
  sidebarVisible.value = visible
  shell.setPreference(SIDEBAR_VISIBLE_KEY, String(visible))
  await nextTick()
  if (!visible && focusInSidebar) editor.value?.focus()
}

const sidebar = ref<HTMLElement | null>(null)

function startResize(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  const startX = event.clientX
  const startWidth = sidebarWidth.value
  let requested = startWidth
  resizing.value = true
  handle.setPointerCapture?.(event.pointerId)
  const move = (moveEvent: PointerEvent) => {
    requested = startWidth + moveEvent.clientX - startX
    setSidebarWidth(requested)
  }
  const end = () => {
    resizing.value = false
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    if (requested < SIDEBAR_COLLAPSE) void setSidebarVisible(false)
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

/**
 * 键盘焦点所在的区域：菜单栏按它决定哪些命令可用（app_menu.ts）。
 * focusin / focusout 覆盖所有焦点移动；焦点离开到页面之外时为 other。
 */
const focusRegion = ref<FocusRegion>('other')

function regionOf(element: Element | null): FocusRegion {
  if (!(element instanceof HTMLElement)) return 'other'
  if (element.closest('.chapter-editor__content')) return 'editor'
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return 'text-input'
  if (element.closest('.chapter-tree__list')) return 'tree'
  return 'other'
}

/** 最近一次获得焦点的元素（弹出面板以外）：从菜单栏打开的面板关闭后，焦点回到这里。 */
let lastFocused: HTMLElement | null = null

function onFocusChange(event: FocusEvent): void {
  const target = event.type === 'focusin' ? event.target : event.relatedTarget
  focusRegion.value = regionOf(target as Element | null)
  if (event.type === 'focusin' && target instanceof HTMLElement && !stylePanel.value?.contains(target)) {
    lastFocused = target
  }
}

onMounted(() => {
  globalThis.document.addEventListener('focusin', onFocusChange)
  globalThis.document.addEventListener('focusout', onFocusChange)
  focusRegion.value = regionOf(globalThis.document.activeElement)
})
onBeforeUnmount(() => {
  globalThis.document.removeEventListener('focusin', onFocusChange)
  globalThis.document.removeEventListener('focusout', onFocusChange)
})

const NO_MOVES = { up: false, down: false, outdent: false, indent: false } as const

const menus = computed(() =>
  workspaceMenus({
    mode: mode.value,
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
  }),
)

watch(menus, (next) => shell.setAppMenu?.(next, (id) => void runMenuItem(id)), { immediate: true })

/** 执行菜单栏（或它的快捷键）中的一项。 */
async function runMenuItem(id: string): Promise<void> {
  const [group, name] = id.split(':') as [string, string]
  if (group === 'editor') {
    runCommand(name as EditorCommand)
    return
  }
  switch (id) {
    case 'file:new':
      emit('new-project')
      return
    case 'file:open':
      emit('open-project')
      return
    case 'file:rename':
      void documentTitle.value?.startRename()
      return
    case 'file:reveal':
      void shell.revealFile(props.session.path)
      return
    case 'file:save':
      void props.session.save()
      return
    case 'file:export-docx':
      void exportAs('docx')
      return
    case 'file:export-pdf':
      void exportAs('pdf')
      return
    case 'edit:undo':
    case 'edit:redo':
      // 正文有自己的撤销历史；普通输入框交给浏览器。
      if (focusRegion.value === 'editor') runCommand(name as EditorCommand)
      else globalThis.document.execCommand(name)
      return
    case 'format:style':
      void openStylePanel()
      return
    case 'view:sidebar':
      void setSidebarVisible(!sidebarVisible.value)
      return
    case 'view:preview':
      togglePreview()
      return
  }
  if (group !== 'chapter') return
  // 章节命令作用于侧栏中的章节：侧栏隐藏时先显示出来，新建与重命名才看得见。
  if (!sidebarVisible.value && name !== 'delete') await setSidebarVisible(true)
  const manager = chapters.value
  if (!manager) return
  if (name === 'new') manager.createChapter()
  else if (name === 'new-child') manager.createChildChapter()
  else if (name === 'rename') manager.renameChapter()
  else if (name === 'delete') manager.deleteChapter()
  else if (name.startsWith('move-')) manager.moveChapter(name.slice('move-'.length) as KeyboardMoveDirection)
}

/**
 * 快捷键：按菜单栏中的同一份快捷键执行。已被焦点处（正文、章节树、输入框）处理的按键不再处理；
 * macOS 上系统菜单栏会先于或代替这里响应，同一次按键只执行一次。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  const id = menuItemForKey(menus.value, event)
  if (id !== null) {
    event.preventDefault()
    void runMenuItem(id)
    return
  }
  // 全文预览中按 Esc 回到编辑（菜单、面板、对话框、重命名自己处理的 Esc 不会走到这里）。
  if (event.key === 'Escape' && mode.value === 'preview') {
    event.preventDefault()
    void setMode('edit')
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
    <aside v-show="sidebarVisible" ref="sidebar" class="workspace__sidebar" aria-label="文档结构">
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
          @rename="renameDocument"
        />
        <SaveStatus
          v-if="status === 'failed'"
          class="workspace__save-status"
          :status="status"
          :error="lastError"
          @retry="session.save()"
        />

        <div class="workspace__spacer" data-tauri-drag-region></div>

        <div v-if="mode === 'edit' && selectedChapter" class="workspace__group" role="toolbar" aria-label="插入">
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
            :class="{ 'workspace__tool--on': mode === 'preview' }"
            aria-label="全文预览"
            :aria-pressed="mode === 'preview'"
            :title="mode === 'preview' ? '回到编辑（Esc）' : '全文预览'"
            @click="togglePreview"
          >
            <Icon name="preview" />
          </button>
          <div class="workspace__anchor">
            <button
              ref="styleButton"
              type="button"
              class="workspace__tool"
              tabindex="0"
              :class="{ 'workspace__tool--open': stylePanelOpen }"
              aria-label="文档样式"
              aria-haspopup="dialog"
              :aria-expanded="stylePanelOpen"
              title="文档样式：整本文档的主题、字体与字号"
              @click="toggleStylePanel"
            >
              <Icon name="style" />
            </button>
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
          <template v-if="document.tree.length === 0">
            <p>这份文档还没有章节。</p>
            <!-- 侧栏中已有"新建第一个章节"；侧栏隐藏时才在这里给出同样的操作。 -->
            <button v-if="!sidebarVisible" type="button" class="workspace__placeholder-action" tabindex="0" @click="createFirstChapter">
              新建章节
            </button>
          </template>
          <p v-else>在左侧选择一个章节，开始写作。</p>
        </div>
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

.workspace__anchor {
  position: relative;
}

/* 工具栏按钮：无边框的图标按钮，默认次级前景色；hover 出现浅底，打开 / 开启时保持按下的样子。 */
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
