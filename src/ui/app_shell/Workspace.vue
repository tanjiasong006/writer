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
import ChapterEditor, { type ChapterRefRequest, type CitationRequest, type EditorStats } from '../editor/ChapterEditor.vue'
import WordCountPopover from './WordCountPopover.vue'
import { useDocumentCount } from './use_word_count.ts'
import ChapterRefPicker, { type RefPick } from '../editor/ChapterRefPicker.vue'
import { chapterRefAddress, elementRefAddress, newElementId } from '../../domain/chapter_reference/chapter_reference.ts'
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
import { useFind } from './use_find.ts'
import { useRemovedChapters } from './use_removed_chapters.ts'
import FindBar from './FindBar.vue'
import HistoryDialog from './HistoryDialog.vue'
import TextPopover from '../editor/TextPopover.vue'
import type { ChapterStatus } from '../../domain/chapter_tree/chapter_tree.ts'
import ExternalChangeDialog from './ExternalChangeDialog.vue'
import { useExternalChanges } from './use_external_changes.ts'
import { useHistory } from './use_history.ts'
import { messageForStorageFailure } from './storage_messages.ts'
import { appendImage, structureSources } from '../editor/markdown.ts'
import { documentStructureImages } from '../editor/structure_view.ts'
import { embeddableImage } from './embeddable_image.ts'
import { chapterRefLabels, citationRefLabels, combineRefLabels, elementRefLabels } from '../editor/chapter_ref_view.ts'
import { useCitations } from './use_citations.ts'
import CitationPicker from '../editor/CitationPicker.vue'
import ReferencesDialog from './ReferencesDialog.vue'
import { citationAddress, formatReference, type ReferenceEntry } from '../../domain/bibliography/bibliography.ts'
import { useElementIndex } from './use_elements.ts'
import type { TemplateId } from './document_templates.ts'
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
  /** 可以更新到的版本：顶栏中常驻“更新到 x.y.z”，点击查看更新说明。 */
  updateVersion?: string | null
  /** 最近打开的项目（文件 → 打开最近）。 */
  recent?: readonly string[]
  appearance: Appearance
}>()

const emit = defineEmits<{
  'new-project': [template?: TemplateId]
  'open-project': []
  'dismiss-notice': []
  'set-appearance': [appearance: Appearance]
  /** 帮助 → 检查更新…（应用级，由 App 处理）。 */
  'check-update': []
  /** 文件 → 打开最近（index 为 null 表示清除列表），由 App 处理。 */
  'open-recent': [index: number | null]
  'show-update': []
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
  layoutDialog.value ? createPdfPreview(output, props.session.path, document.value, documentStructureImages) : null,
)
const reader = ref<InstanceType<typeof DocumentReader> | null>(null)

const { selectedId, collapsedIds, goal, today, ready: uiReady } = useUiState(shell, props.session.path, () => document.value.tree)

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
    exportDocument(output, props.session.path, document.value, props.session.pdfLayout, format, target, documentStructureImages),
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
  { separator: true },
  { id: 'markdown', label: '导出为 Markdown…' },
  { id: 'html', label: '导出为 HTML…' },
  { id: 'epub', label: '导出为 EPUB…' },
]

async function openExportMenu(event: MouseEvent): Promise<void> {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const chosen = await showButtonMenu('export', EXPORT_ITEMS, { rect, align: 'end' }, event.detail === 0)
  if (chosen === 'docx' || chosen === 'markdown' || chosen === 'html' || chosen === 'epub') void exportAs(chosen)
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
  placeImage(chapterId, result.value.reference)
}

/**
 * 粘贴或拖入的图片：依次导入项目 assets/（Word / PDF 不能直接嵌入的格式先转为 PNG），在光标处插入。
 * 某一张失败时说明原因，其余照常插入。
 */
async function insertImageFiles(chapterId: ChapterId, files: readonly File[]): Promise<void> {
  actionError.value = null
  for (const file of files) {
    const data = await embeddableImage(file)
    if (data === null) {
      actionError.value = `无法插入图片“${file.name || '粘贴的图片'}”：不支持这种图片格式。`
      continue
    }
    const result = await props.session.importAssetData(data.name, data.bytes)
    if (!result.ok) {
      actionError.value = messageForStorageFailure(result.error)
      continue
    }
    placeImage(chapterId, result.value.reference)
  }
}

/** 在发起请求的章节中插入图片引用。图注为空，不用文件名代替（图注会出现在导出中），需要时由作者添加。 */
function placeImage(chapterId: ChapterId, reference: string): void {
  if (editor.value?.insertImage(chapterId, reference, '')) return
  // 期间切换了章节：追加到发起请求的章节末尾，不插错位置。
  const text = props.session.document.contents.get(chapterId)
  if (text !== undefined) props.session.setContent(chapterId, appendImage(text, reference, ''))
}

/** 正文中的图片引用 → 编辑器中可显示的地址（只显示项目内的文件）。 */
function resolveImage(reference: string): string | null {
  const path = props.session.assetPath(reference)
  return path === null ? null : shell.toDisplayUrl(path)
}

/**
 * 专注模式（docs/decisions.md 第 15 节）：窗口全屏，侧栏与工具栏隐去（鼠标移到窗口顶部时工具栏出现），
 * 正文中当前段落以外的内容淡化。不改变侧栏的偏好，退出后恢复原样；不持久化。
 */
const focusMode = ref(false)

function setFocusMode(on: boolean): void {
  if (focusMode.value === on) return
  focusMode.value = on
  shell.setFullscreen?.(on)
  void nextTick(() => editor.value?.focus())
}

onBeforeUnmount(() => {
  if (focusMode.value) shell.setFullscreen?.(false)
})

/** 全文阅读（docs/decisions.md 第 8 节）：编辑环境中的连续只读展示，不是导出效果预览。 */
const reading = ref(false)
/** 进入阅读时的位置：编辑器中正在看的地方。 */
const readingStart = shallowRef<ReadingPosition | null>(null)

function openReading(): void {
  if (reading.value || tree.value.length === 0) return
  setFocusMode(false)
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
/**
 * 图表编号（docs/decisions.md 第 12 节）：全文按阅读顺序、一级章节分组。
 * 引用的文字只在章节树或图表编号变化时更新（signature），输入文字时不变。
 */
const elements = useElementIndex({
  chapters: () => readingOrder().map((id) => ({ id, top: numbers.value.get(id)?.[0] ?? null })),
  contents: () => document.value.contents,
})
const elementLabels = computed(() => {
  void elements.signature.value
  return elementRefLabels((kind, id) => elements.index.value.find(kind, id))
})
/** 文献引用的编号（docs/decisions.md 第 13 节）：按全文中第一次引用的顺序。 */
const citations = useCitations({
  order: readingOrder,
  contents: () => document.value.contents,
  references: () => document.value.references,
})
const citationLabels = computed(() => {
  void citations.signature.value
  const references = document.value.references
  return citationRefLabels((id) => {
    const number = citations.numbers.value.get(id)
    const entry = references.find((candidate) => candidate.id === id)
    return number === undefined || !entry ? null : { number, text: formatReference(entry) }
  })
})
/** 引用的文字（章节、图表与文献）：随章节树、图表编号与文献编号变化，编辑正文时不变。 */
const refLabel = computed(() =>
  combineRefLabels(chapterRefLabels(tree.value), elementLabels.value, citationLabels.value),
)

/** 选择文献引用的浮层与参考文献对话框。 */
const citationPicker = shallowRef<{ readonly chapterId: ChapterId; readonly request: CitationRequest } | null>(null)
const referencesDialog = shallowRef<{ readonly initial: string | null; readonly fromPicker: boolean } | null>(null)

function requestCitation(chapterId: ChapterId, request: CitationRequest): void {
  citationPicker.value = { chapterId, request }
}

/** 插入（或更改为）选中的文献；文字是它的编号（还没有被引用时是下一个编号）。 */
function pickCitation(id: string): void {
  const picker = citationPicker.value
  citationPicker.value = null
  const number = picker ? citations.numberIfInserted(picker.chapterId, picker.request.index, id) : 0
  if (picker && editor.value?.insertChapterRef(picker.chapterId, citationAddress(id), `[${number}]`)) return
  editor.value?.focus()
}

function cancelCitation(): void {
  citationPicker.value = null
  editor.value?.focus()
}

/** 从文献浮层打开参考文献对话框：完成后回到浮层继续选择。 */
function manageReferences(): void {
  const picker = citationPicker.value
  referencesDialog.value = { initial: picker?.request.current ?? null, fromPicker: picker !== null }
  if (picker) pendingPicker = picker
  citationPicker.value = null
}
let pendingPicker: { readonly chapterId: ChapterId; readonly request: CitationRequest } | null = null

function finishReferences(references: ReferenceEntry[]): void {
  props.session.setReferences(references)
  closeReferences()
}

function closeReferences(): void {
  const fromPicker = referencesDialog.value?.fromPicker ?? false
  referencesDialog.value = null
  if (fromPicker && pendingPicker && pendingPicker.chapterId === selectedId.value) citationPicker.value = pendingPicker
  else editor.value?.focus()
  pendingPicker = null
}

function confirmReferenceDelete(count: number): Promise<boolean> {
  return shell.confirm(`这条文献在正文中被引用了 ${count} 处，删除后这些引用会失效。\n\n仍要删除吗？`, {
    ok: '删除',
    cancel: '取消',
  })
}
/** 当前章节图表编号的起点。 */
const elementStart = computed(() =>
  selectedId.value === null ? undefined : elements.index.value.start(selectedId.value),
)

/** 选择章节引用的目标：发起请求的章节与位置（docs/decisions.md 第 9 节）。 */
const refPicker = shallowRef<{ readonly chapterId: ChapterId; readonly request: ChapterRefRequest } | null>(null)

function requestChapterRef(chapterId: ChapterId, request: ChapterRefRequest): void {
  refPicker.value = { chapterId, request }
}

/**
 * 选好引用目标后插入。引用的图表还没有标识时先给它一个（写进它所在章节的正文）；
 * 链接文字是它当前的编号（图表编号此时还没有随新标识更新）。
 */
function pickChapterRef(target: RefPick): void {
  const picker = refPicker.value
  refPicker.value = null
  let href: string
  let text: string | undefined
  if (target.kind === 'chapter') href = chapterRefAddress(target.id, target.show)
  else {
    const { element } = target
    let id = element.id
    if (id === null) {
      id = newElementId()
      const content = document.value.contents.get(element.chapterId) ?? ''
      editor.value?.assignElementId(element.chapterId, content, element.kind, element.index, id)
    }
    href = elementRefAddress(element.kind, id)
    text = element.label
  }
  if (picker && editor.value?.insertChapterRef(picker.chapterId, href, text)) return
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
/** 正在编辑的章节以外的结构式（按阅读顺序）：结构式浮层列出本文档中用过的分子。 */
function otherStructures(): string[] {
  return readingOrder()
    .filter((id) => id !== selectedId.value)
    .flatMap((id) => structureSources(document.value.contents.get(id) ?? '').map((source) => source.smiles))
}

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

/** 查找与替换（use_find.ts）：查找栏在工具栏下方，全文阅读中不显示。 */
const find = useFind({
  order: readingOrder,
  contents: () => document.value.contents,
  selectedId,
  editor: () => editor.value,
})
const findBar = ref<InstanceType<typeof FindBar> | null>(null)
watch(find.query, find.onQueryChange)

/** 打开查找栏：正文中有选中的文字时用它作查找词；已打开时回到查找框。 */
async function openFind(withReplace: boolean): Promise<void> {
  if (reading.value || !selectedChapter.value) return
  const initial = focusRegion.value === 'editor' ? (editor.value?.selectedText() ?? '') : ''
  const wasOpen = find.open.value
  find.show(withReplace, initial)
  if (wasOpen) {
    await nextTick()
    findBar.value?.focusQuery()
  }
}

/** 关闭查找栏：焦点回到正文，当前匹配保持选中。 */
function closeFind(): void {
  find.close()
  editor.value?.focus()
}

/** 字数：编辑器报告当前章节与选区，全文按需计算（打开字数统计时）。 */
const stats = shallowRef<EditorStats | null>(null)
const documentCount = useDocumentCount({
  contents: () => document.value.contents,
  refLabel: () => refLabel.value,
  live: () => stats.value,
})
/** 工具栏中字数显示的文字：有选中内容时是选中的字数。 */
const countLabel = computed(() => {
  const current = stats.value
  if (!current || current.chapterId !== selectedId.value) return ''
  const format = (value: number) => value.toLocaleString('zh-CN')
  return current.selection ? `已选 ${format(current.selection.words)} 字` : `${format(current.chapter.words)} 字`
})
const countPopover = shallowRef<{ readonly right: number; readonly bottom: number } | null>(null)

/** 本地日期 YYYY-MM-DD。 */
function localDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * 写作目标与今日进度（docs/decisions.md 第 17 节）：每天第一次打开字数统计时记下当时的全文字数，
 * 之后显示与它的差（今天新增的字数）。
 */
const todayWords = computed<number | null>(() => {
  const start = today.value
  return start && start.date === localDate() ? documentCount.value.words - start.startWords : null
})

watch(countPopover, (open) => {
  if (!open || !uiReady.value) return
  if (today.value?.date !== localDate()) today.value = { date: localDate(), startWords: documentCount.value.words }
})

function openCountPopover(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  countPopover.value = { right: window.innerWidth - rect.right, bottom: rect.bottom }
}

function closeCountPopover(): void {
  countPopover.value = null
}

/** 版本历史（docs/project-format.md 第 7.1 节）；打开文档后每天自动留下一个版本。 */
const history = useHistory({
  session: props.session,
  confirm: (message) => shell.confirm(message, { ok: '恢复', cancel: '取消' }),
  onError: (failure) => (actionError.value = messageForStorageFailure(failure)),
})
onMounted(() => void history.autoSnapshot())

function snapshotName(snapshot: { readonly label: string; readonly createdAt: number }): string {
  return snapshot.label || new Date(snapshot.createdAt).toLocaleString('zh-CN')
}

/** 其他程序对项目文件的修改（known-risks #4）。 */
const external = useExternalChanges({ session: props.session, name: (id) => chapterName(id) })

/** 编辑章节备注（docs/decisions.md 第 16 节）：在章节行（或章节标题）下方的浮层中。 */
const noteEditor = shallowRef<{ readonly chapterId: ChapterId; readonly anchor: { readonly x: number; readonly y: number } } | null>(null)

function editNote(chapterId: ChapterId, rect: DOMRect | null): void {
  const anchor = rect ? { x: rect.left + 24, y: rect.bottom } : { x: window.innerWidth / 2 - 180, y: 120 }
  noteEditor.value = { chapterId, anchor }
}

function commitNote(note: string): void {
  const editing = noteEditor.value
  noteEditor.value = null
  if (editing) chapters.value?.setNote(editing.chapterId, note)
}

/** 撤销删除章节（ui-spec §23）。 */
const removedChapters = useRemovedChapters({
  tree: () => tree.value,
  contents: () => document.value.contents,
  apply: (next, restored) => props.session.applyTree(next, restored),
  select: (id) => (selectedId.value = id),
})

/** 撤销删除：恢复的章节被选中；从章节树中撤销时焦点落在它上面。 */
async function undoDelete(): Promise<void> {
  const fromTree = focusRegion.value === 'tree'
  if (!removedChapters.undo()) return
  if (!sidebarVisible.value) await setSidebarVisible(true)
  if (fromTree) {
    await nextTick()
    chapters.value?.focusCurrent()
  }
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
    focusMode: focusMode.value,
    canGoBack: jumps.canGoBack.value,
    canGoForward: jumps.canGoForward.value,
    canUndoDelete: removedChapters.canUndo.value,
    recent: props.recent,
    chapterStatus: selectedChapter.value?.status ?? null,
    chapterHasNote: !!selectedChapter.value?.note,
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
        case 'export-markdown':
          void exportAs('markdown')
          return
        case 'export-html':
          void exportAs('html')
          return
        case 'export-epub':
          void exportAs('epub')
          return
        case 'export-pdf':
          layoutDialog.value = 'export'
          return
        case 'pdf-layout':
          layoutDialog.value = 'save'
          return
        case 'history':
          void history.show()
          return
      }
      return
    case 'edit':
      if (command.action === 'list-menu') {
        if (focusRegion.value === 'editor') void editor.value?.openListMenu()
      } else if (command.action === 'find' || command.action === 'find-replace') {
        void openFind(command.action === 'find-replace')
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
      else if (command.action === 'focus-mode') setFocusMode(!focusMode.value)
      else if (command.action === 'back') void jumps.back()
      else if (command.action === 'forward') void jumps.forward()
      else switchFocus()
      return
    case 'insert':
      if (command.action === 'references') referencesDialog.value = { initial: null, fromPicker: false }
      else updateAllChapterRefs()
      return
    case 'appearance':
      emit('set-appearance', command.appearance)
      return
    case 'app':
      if (command.action === 'show-logs') void shell.revealLogFolder?.()
      else emit('check-update')
      return
    case 'recent':
      emit('open-recent', command.index)
      return
    case 'template':
      emit('new-project', command.template)
      return
    case 'chapter':
    case 'move-chapter': {
      // 章节命令作用于侧栏中的章节：侧栏隐藏时先显示出来，新建与重命名才看得见。
      const isDelete = command.group === 'chapter' && (command.action === 'delete' || command.action === 'undo-delete')
      if (!sidebarVisible.value && !isDelete) await setSidebarVisible(true)
      const manager = chapters.value
      if (!manager) return
      if (command.group === 'move-chapter') {
        manager.moveChapter(command.direction)
        return
      }
      if (command.action === 'undo-delete') {
        void undoDelete()
        return
      }
      if (command.action === 'note') {
        await nextTick()
        if (selectedId.value !== null) editNote(selectedId.value, manager.rowRect(selectedId.value))
        return
      }
      if (command.action.startsWith('status-')) {
        const status = command.action.slice('status-'.length)
        manager.setStatus(status === 'none' ? null : (status as ChapterStatus))
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
      'workspace--sidebar-hidden': !sidebarVisible || focusMode,
      'workspace--focus': focusMode,
    }"
    :style="{ '--sidebar-w': `${sidebarWidth}px` }"
    :data-save-status="status"
  >
    <aside v-show="sidebarVisible && !focusMode" ref="sidebarElement" class="workspace__sidebar" aria-label="文档结构">
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
        @removed="removedChapters.record"
        @edit-note="editNote"
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

        <button
          v-if="selectedChapter && !reading && countLabel"
          type="button"
          class="workspace__count"
          :class="{ 'workspace__count--open': countPopover !== null }"
          tabindex="0"
          aria-haspopup="dialog"
          :aria-expanded="countPopover !== null"
          title="字数统计"
          @click="openCountPopover"
        >
          {{ countLabel }}
        </button>

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

        <button
          v-if="focusMode"
          type="button"
          class="workspace__exit-focus"
          tabindex="0"
          @click="setFocusMode(false)"
        >
          退出专注模式
        </button>

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

        <button
          v-if="updateVersion"
          type="button"
          class="workspace__update"
          tabindex="0"
          :title="`${shell.appName} ${updateVersion} 可以更新，查看更新说明`"
          @click="emit('show-update')"
        >
          更新到 {{ updateVersion }}
        </button>
      </header>

      <FindBar
        v-if="find.open.value && !reading && selectedChapter"
        ref="findBar"
        v-model:query="find.query.value"
        v-model:replacement="find.replacement.value"
        v-model:scope="find.scope.value"
        v-model:show-replace="find.showReplace.value"
        :total="find.total.value"
        :position="find.position.value"
        :replaced-count="find.replacedCount.value"
        @next="find.step('next')"
        @previous="find.step('previous')"
        @replace="find.replace()"
        @replace-all="find.replaceAll()"
        @close="closeFind"
      />

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
          :find-query="find.open.value && !reading ? find.query.value : ''"
          :element-start="elementStart"
          :focus-mode="focusMode"
          :note="selectedChapter.note ?? ''"
          :other-structures="otherStructures"
          @edit-note="(rect: DOMRect) => selectedId !== null && editNote(selectedId, rect)"
          @find-status="find.setSelected"
          @stats="stats = $event"
          @change="(chapterId, text) => session.setContent(chapterId, text)"
          @request-image="insertImage"
          @request-image-files="insertImageFiles"
          @request-chapter-ref="requestChapterRef"
          @request-citation="requestCitation"
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
          :ref-label="refLabel"
          :element-start="(id: ChapterId) => elements.index.value.start(id)"
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
        <Toast v-if="removedChapters.notice.value" class="workspace__removed" @dismiss="removedChapters.dismiss">
          {{ removedChapters.notice.value }}
          <template #actions>
            <button type="button" @click="undoDelete">撤销</button>
          </template>
        </Toast>
        <Toast v-if="external.notice.value" class="workspace__external" @dismiss="external.dismiss">
          {{ external.notice.value }}
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

    <ExternalChangeDialog
      v-if="external.conflict.value"
      :chapters="external.conflict.value.chapters.map(chapterName)"
      :structure="external.conflict.value.structure"
      @keep="external.keepWriter"
      @disk="external.useDisk"
    />

    <TextPopover
      v-if="noteEditor"
      :anchor="noteEditor.anchor"
      label="章节备注"
      placeholder="写给自己的备注（不会导出）"
      :text="findChapter(tree, noteEditor.chapterId)?.note ?? ''"
      multiline
      @commit="commitNote"
      @cancel="noteEditor = null"
    />

    <HistoryDialog
      v-if="history.open.value"
      :snapshots="history.snapshots.value"
      :busy="history.busy.value"
      @create="history.create"
      @restore="(snapshot) => history.restore(snapshot, snapshotName(snapshot))"
      @delete="history.remove"
      @close="history.close"
    />

    <WordCountPopover
      v-if="countPopover && stats"
      :anchor="countPopover"
      :selection="stats.selection"
      :chapter="stats.chapter"
      :document="documentCount"
      :goal="goal"
      :today="todayWords"
      @set-goal="goal = $event"
      @close="closeCountPopover"
    />

    <ChapterRefReportDialog
      v-if="refReport"
      :chapters="refReport.texts.size"
      :updated="refReport.updated"
      :broken="refReport.broken"
      :chapter-name="chapterName"
      @select="showBrokenRef"
      @close="closeRefReport"
    />

    <CitationPicker
      v-if="citationPicker"
      :references="document.references"
      :numbers="citations.numbers.value"
      :anchor="citationPicker.request.anchor"
      :current="citationPicker.request.current"
      @pick="pickCitation"
      @manage="manageReferences"
      @cancel="cancelCitation"
    />

    <ReferencesDialog
      v-if="referencesDialog"
      :references="document.references"
      :numbers="citations.numbers.value"
      :initial="referencesDialog.initial"
      :confirm-delete="confirmReferenceDelete"
      :citation-count="citations.count"
      @submit="finishReferences"
      @cancel="closeReferences"
    />

    <ChapterRefPicker
      v-if="refPicker"
      :tree="tree"
      :anchor="refPicker.request.anchor"
      :current="refPicker.request.current"
      :elements="elements.index.value.entries"
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

/* 字数：安静的次级文字，点击查看本章与全文的统计。宽度随数字变化时不推动右侧按钮（右对齐、等宽数字）。 */
.workspace__count {
  flex: none;
  height: var(--control-h-m);
  margin-right: var(--space-4);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: var(--color-text-tertiary);
  font: inherit;
  font-size: var(--text-s);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.workspace__count:hover,
.workspace__count--open {
  background: var(--color-fill-hover);
  color: var(--color-text-secondary);
}

.workspace__count:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
}

/* 专注模式：工具栏隐去，鼠标移到窗口顶部（或焦点进入工具栏）时出现；正文从窗口顶部开始。 */
.workspace--focus .workspace__bar {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 10;
  background: var(--color-bg);
  opacity: 0;
  transition: opacity var(--duration-slow) var(--ease-out);
}

.workspace--focus .workspace__bar:hover,
.workspace--focus .workspace__bar:focus-within {
  opacity: 1;
}

.workspace__exit-focus {
  flex: none;
  height: var(--control-h-s);
  margin-right: var(--space-5);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--text-s);
}

.workspace__exit-focus:hover {
  background: var(--color-fill-pressed);
  color: var(--color-text);
}

/* 有新版本时常驻顶栏末端：强调色文字与浅底，比工具按钮醒目，但不抢正文。 */
.workspace__update {
  flex: none;
  height: var(--control-h-s);
  margin-left: var(--space-5);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-accent-fill);
  color: var(--color-accent-text);
  font: inherit;
  font-size: var(--text-s);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease-out);
}

.workspace__update:hover {
  background: var(--color-accent-fill-strong);
}

.workspace__update:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
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
