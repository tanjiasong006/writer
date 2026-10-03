<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EditorView } from 'prosemirror-view'
import { NodeSelection, Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { ChapterDocuments } from './chapter_documents.ts'
import {
  commandState,
  editorCommands,
  insertChapterRef,
  insertFootnote,
  insertImage,
  insertMath,
  insertMathBlock,
  selectedMath,
  setMath,
  setTableCaption,
  setElementId,
  selectedFootnote,
  setFootnoteText,
  selectedChapterRef,
  setChapterRefShow,
  setCodeLanguage,
  type CommandState,
  type EditorCommand,
} from './commands.ts'
import { fenceLanguage } from './code_highlight.ts'
import { editorContextMenu, listEntries } from './editor_menu.ts'
import { IS_MAC, SHORTCUTS, matchesShortcut } from '../common/shortcuts.ts'
import { nodes } from './schema.ts'
import PopupMenu, { type MenuAnchor } from '../common/PopupMenu.vue'
import TextPopover from './TextPopover.vue'
import MathPopover from './MathPopover.vue'
import { mathNodeView } from './math_view.ts'
import { chapterLabels, NO_ELEMENT_START, type ElementStart } from './element_numbering.ts'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { footnoteNumber, footnotesOf } from './footnote_view.ts'
import { useMenu } from '../common/use_menu.ts'
import { editSelectedCaption, figureNodeView, imageNodeView, type ImageResolver } from './image_view.ts'
import { NO_CHAPTER_REFS, chapterRefNodeViews, chapterRefPos, type ChapterRefLabel } from './chapter_ref_view.ts'
import { parseChapterRefAddress, type ChapterRefShow } from '../../domain/chapter_reference/chapter_reference.ts'
import { DEFAULT_EDITOR_THEME, editorHeadingVars, editorThemeCssVars } from './editor_theme.ts'
import { topBlock, type BlockPosition } from './block_position.ts'
import { countDoc, countSelection } from './text_stats.ts'
import type { TextCount } from '../../domain/word_count/word_count.ts'
import {
  findDecorations,
  findMatches,
  nextMatchIndex,
  previousMatchIndex,
  replaceMatches,
  selectedMatchIndex,
  type FindMatch,
} from './find.ts'
import './document_body.css'

/**
 * 章节正文编辑器：ProseMirror 结构化编辑，正文仍以 Markdown 保存（docs/decisions.md 第 2 节）。
 *
 * - 整个组件只有一个 EditorView；切换章节时换入该章节缓存的 EditorState（撤销历史、选区仍在），不重建视图。
 * - 只有文档真正改变时才发出 change；change 携带事务发生时的章节 id，切换章节后不会写错章节。
 * - 父组件把 change 回传为 content 时不做任何事；只有与编辑器不一致的 content（外部修改）才替换文档。
 * - 章节标题与编号只显示在编辑器上方，不进入正文。
 * - 编辑环境的展示参数（editor_theme.ts）以 CSS 变量作用在外层元素上：不改变文档、不产生 change、
 *   不进入撤销历史、不重建视图，也不读取项目数据。
 * - 图片按统一规则适应编辑区域，没有单张图片的尺寸 / 对齐设置；图片的插入、选择、删除属于正文编辑。
 *   独立成段的图片下方显示并编辑图注（image_view.ts），图注文本框中的按键与右键不交给正文。
 * - 章节引用的文字按 refLabel（当前章节树）显示与写出；refLabel 变化只更新显示，不产生 change。
 * - 编辑器自己没有工具栏：命令的可用 / 勾选状态以 tools 发出，由工作区的工具栏与菜单栏显示，
 *   它们通过 runCommand 执行命令。右键菜单列出与点击处相关的操作。
 */
const props = defineProps<{
  chapterId: ChapterId
  content: string
  /** 章节编号的显示文本，如 "2.1"。 */
  number: string
  title: string
  /** 正文中图片引用的显示地址；不提供时图片显示为占位。 */
  resolveImage?: ImageResolver
  /** 章节引用的文字（按当前章节树生成）；不提供时引用显示为失效。 */
  refLabel?: ChapterRefLabel
  /** 查找中的文字：正文中高亮全部匹配（不进入文档）；空串表示没有在查找。 */
  findQuery?: string
  /** 本章图表编号的起点（所在一级章节与之前的图、表数量，element_numbering.ts）；只影响显示。 */
  elementStart?: ElementStart
}>()

const emit = defineEmits<{
  change: [chapterId: ChapterId, text: string]
  /** 用户点击了"插入图片"；由上层选择并导入图片后调用 insertImage。 */
  'request-image': [chapterId: ChapterId]
  /**
   * 粘贴或拖入了图片文件：光标已放在插入处（拖入时是放下的位置），由上层导入项目资源后调用 insertImage。
   */
  'request-image-files': [chapterId: ChapterId, files: File[]]
  /** 编辑命令的可用 / 勾选状态（由上层的工具栏与菜单栏显示）。 */
  tools: [state: CommandState]
  /**
   * 插入章节引用（选中引用时是更改它）：由上层在 anchor 处选择目标后调用 insertChapterRef。
   * current 是选中引用当前的目标与格式（失效或插入时为 null / 只有格式）。
   */
  'request-chapter-ref': [chapterId: ChapterId, request: ChapterRefRequest]
  /** 插入文献引用（选中文献引用时是更改它）：由上层在 anchor 处选择文献后调用 insertChapterRef。 */
  'request-citation': [chapterId: ChapterId, request: CitationRequest]
  /** 前往章节引用的目标章节（⌘ + 单击、右键菜单“前往”）。 */
  'open-chapter': [chapterId: ChapterId]
  /** 查找中：选区恰好是第几个匹配（-1 表示不是匹配），选区或正文变化时发出。 */
  'find-status': [chapterId: ChapterId, selected: number]
  /** 当前章节与选区的字数（text_stats.ts），正文、选区或章节变化时发出。 */
  stats: [stats: EditorStats]
}>()

/** 编辑器报告的字数。 */
export interface EditorStats {
  readonly chapterId: ChapterId
  readonly chapter: TextCount
  /** 选中内容的字数；没有选中内容时为 null。 */
  readonly selection: TextCount | null
}

/** 选择文献时的上下文：浮层的位置与选中的文献引用当前的条目。 */
export interface CitationRequest {
  readonly anchor: { readonly x: number; readonly y: number }
  readonly current: string | null
  /** 插入处之前已有的文献引用数量（插入时计算新引用的编号）。 */
  readonly index: number
}

/** 选择引用目标时的上下文。 */
export interface ChapterRefRequest {
  /** 浮层的位置：光标（或选中引用）的左下角。 */
  readonly anchor: { readonly x: number; readonly y: number }
  /** 选中的引用当前的目标与格式；插入新引用时为 null。 */
  readonly current: {
    readonly id: ChapterId | null
    readonly show: ChapterRefShow
    readonly element?: { readonly kind: 'figure' | 'table'; readonly id: string }
  } | null
}

/** 滚动容器（每个章节记住自己的滚动位置）。 */
const scroller = ref<HTMLElement | null>(null)
const heading = ref<HTMLElement | null>(null)
const mountPoint = ref<HTMLElement | null>(null)
const tools = shallowRef<CommandState | null>(null)

const THEME_VARS = editorThemeCssVars(DEFAULT_EDITOR_THEME)
/** 章节层级：决定章节标题与正文标题使用哪一级标题样式。 */
const depth = computed(() => Math.max(1, props.number.split('.').filter(Boolean).length))
const themeStyle = computed(() => ({ ...THEME_VARS, ...editorHeadingVars(depth.value) }))

const documents = new ChapterDocuments()
documents.refLabel = props.refLabel ?? NO_CHAPTER_REFS
const chapterRefs = chapterRefNodeViews(documents.refLabel)
watch(
  () => props.refLabel,
  (label) => {
    documents.refLabel = label ?? NO_CHAPTER_REFS
    chapterRefs.setLabel(documents.refLabel)
    // 引用的文字变了，字数可能随之变化。
    statsCache = null
    reportStats()
  },
)
/** 每个章节离开时的滚动位置；回到该章节时恢复，继续在原处写作。 */
const scrolls = new Map<ChapterId, number>()
let view: EditorView | null = null
let currentId = props.chapterId

/**
 * 光标滚动到可见区域时与滚动容器边缘保持的距离：连续输入、换段时光标所在行不会贴在窗口底边，
 * 下方始终能看到一点空白。只在光标接近边缘时滚动，不会每次输入都滚动。
 */
const CARET_MARGIN = { top: 40, bottom: 96, left: 0, right: 0 }

function dispatchTransaction(tr: Transaction): void {
  if (!view) return
  const { state } = view.state.applyTransaction(tr)
  view.updateState(state)
  showState(state)
  const text = documents.update(currentId, state)
  if (text !== null) emit('change', currentId, text)
  reportFind()
  reportStats()
}

/** 字数：章节的字数按文档缓存，只移动光标时不重新计算。 */
let statsCache: { readonly doc: EditorState['doc']; readonly count: TextCount } | null = null
let lastStats: EditorStats | null = null

function reportStats(): void {
  if (!view) return
  const { doc, selection } = view.state
  const label = documents.refLabel ?? NO_CHAPTER_REFS
  if (statsCache?.doc !== doc) statsCache = { doc, count: countDoc(doc, label) }
  const next: EditorStats = {
    chapterId: currentId,
    chapter: statsCache.count,
    selection: countSelection(doc, selection.from, selection.to, label),
  }
  if (
    lastStats?.chapterId === next.chapterId &&
    sameCount(lastStats.chapter, next.chapter) &&
    sameCount(lastStats.selection, next.selection)
  ) return
  lastStats = next
  emit('stats', next)
}

function sameCount(a: TextCount | null, b: TextCount | null): boolean {
  return a === b || (a !== null && b !== null && a.words === b.words && a.characters === b.characters)
}

/**
 * 图表编号（docs/decisions.md 第 12 节）：有图注的图在图注前显示“图 2-1”（交给图片的节点视图），
 * 有标题的表格上方显示“表 2-1　标题”（单击编辑）。只是显示，不进入文档；按文档与起点缓存。
 */
let elementCache: { readonly doc: EditorState['doc']; readonly start: ElementStart; readonly set: DecorationSet } | null = null

function elementDecorations(doc: EditorState['doc']): DecorationSet {
  const start = props.elementStart ?? NO_ELEMENT_START
  if (elementCache?.doc === doc && sameStart(elementCache.start, start)) return elementCache.set
  const decorations: Decoration[] = []
  for (const [pos, label] of chapterLabels(doc, start)) {
    const node = doc.nodeAt(pos)!
    if (node.type === nodes.figure) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { elementLabel: label }))
    } else {
      const caption = (node.attrs.caption as string).trim()
      decorations.push(
        Decoration.widget(pos, () => tableCaptionDOM(label, caption, pos), {
          side: -1,
          key: `table-caption:${pos}:${label}:${caption}`,
          ignoreSelection: true,
          stopEvent: () => true,
        }),
      )
    }
  }
  const set = decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, decorations)
  elementCache = { doc, start, set }
  return set
}

function sameStart(a: ElementStart, b: ElementStart): boolean {
  return a.chapter === b.chapter && a.figures === b.figures && a.tables === b.tables
}

function tableCaptionDOM(label: string, caption: string, pos: number): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'table-caption'
  dom.contentEditable = 'false'
  dom.dataset.tableCaptionPos = String(pos)
  dom.title = '单击编辑表格标题'
  const number = document.createElement('span')
  number.className = 'table-caption__label'
  number.textContent = label
  dom.append(number, caption)
  return dom
}

watch(
  () => props.elementStart,
  (next, previous) => {
    if (!view || (next && previous && sameStart(next, previous))) return
    view.updateState(view.state)
  },
)

/** 查找：当前文档中的匹配（按文档缓存，输入时只在文档变化后重新计算）。 */
let findCache: { readonly doc: EditorState['doc']; readonly query: string; readonly matches: FindMatch[] } | null = null

function currentMatches(state: EditorState): FindMatch[] {
  const query = props.findQuery ?? ''
  if (findCache?.doc !== state.doc || findCache.query !== query) {
    findCache = { doc: state.doc, query, matches: findMatches(state.doc, query) }
  }
  return findCache.matches
}

let lastFindStatus: { readonly chapterId: ChapterId; readonly selected: number } | null = null

function reportFind(): void {
  if (!view || !props.findQuery) return
  const selected = selectedMatchIndex(currentMatches(view.state), view.state.selection)
  if (lastFindStatus?.chapterId === currentId && lastFindStatus.selected === selected) return
  lastFindStatus = { chapterId: currentId, selected }
  emit('find-status', currentId, selected)
}

watch(
  () => props.findQuery,
  () => {
    if (!view) return
    // 重新计算高亮：updateState 用同一个状态时视图会重新取 decorations。
    view.updateState(view.state)
    lastFindStatus = null
    reportFind()
  },
)

function showState(state: EditorState): void {
  const next = commandState(state)
  // 只在变化时更新：输入文字时命令状态通常不变，上层不必每次按键都重新渲染。
  if (sameTools(tools.value, next)) return
  tools.value = next
  emit('tools', next)
}

function sameTools(a: CommandState | null, b: CommandState): boolean {
  if (a === null) return false
  return (Object.keys(b) as EditorCommand[]).every(
    (key) => a[key].enabled === b[key].enabled && a[key].active === b[key].active,
  )
}

onMounted(() => {
  const state = documents.stateFor(currentId, props.content)
  const resolveImage = props.resolveImage ?? (() => null)
  view = new EditorView(mountPoint.value!, {
    state,
    dispatchTransaction,
    scrollThreshold: CARET_MARGIN,
    scrollMargin: CARET_MARGIN,
    handlePaste: (_view, event, slice) => {
      // 同时有文字（如从网页或 Word 复制的图文）时按文字粘贴；只有图片时导入图片。
      const files = imageFiles(event.clipboardData)
      if (files.length === 0 || slice.content.textBetween(0, slice.content.size, '', '').trim() !== '') return false
      emit('request-image-files', currentId, files)
      return true
    },
    handleDrop: (dropView, event, _slice, moved) => {
      const files = moved ? [] : imageFiles(event.dataTransfer)
      if (files.length === 0) return false
      event.preventDefault()
      const hit = dropView.posAtCoords({ left: event.clientX, top: event.clientY })
      if (hit) {
        const { doc } = dropView.state
        dropView.dispatch(dropView.state.tr.setSelection(TextSelection.near(doc.resolve(hit.pos))))
      }
      dropView.focus()
      emit('request-image-files', currentId, files)
      return true
    },
    decorations: (state) => {
      const elements = elementDecorations(state.doc)
      if (!props.findQuery) return elements
      const find = findDecorations(state.doc, currentMatches(state), state.selection)
      return elements === DecorationSet.empty ? find : elements.add(state.doc, find.find())
    },
    nodeViews: {
      image: imageNodeView(resolveImage),
      figure: figureNodeView(resolveImage),
      chapter_ref: chapterRefs.nodeView,
      math: mathNodeView,
      math_block: mathNodeView,
    },
    attributes: { class: 'chapter-editor__content document-body', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '正文' },
  })
  showState(state)
  reportStats()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(
  () => [props.chapterId, props.content] as const,
  ([chapterId, text]) => {
    if (!view || !scroller.value) return
    if (chapterId !== currentId) {
      scrolls.set(currentId, scroller.value.scrollTop)
      // 只有沿用了缓存状态（正文未被外部修改）时，保存的滚动位置才仍然对应同一份内容。
      const reused = documents.isCurrent(chapterId, text)
      currentId = chapterId
      const next = documents.stateFor(chapterId, text)
      view.updateState(next)
      showState(next)
      scroller.value.scrollTop = reused ? (scrolls.get(chapterId) ?? 0) : 0
      reportFind()
      reportStats()
      return
    }
    if (documents.isCurrent(chapterId, text)) return
    // 外部修改了当前章节正文：整体替换，仍保留在撤销历史中；以新正文为基准，不回发 change。
    const doc = documents.rebase(chapterId, text)
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content))
  },
)

function runCommand(command: EditorCommand): void {
  if (!view) return
  if (command === 'image') {
    emit('request-image', currentId)
    return
  }
  if (command === 'chapter-ref') {
    requestChapterRef()
    return
  }
  if (command === 'footnote') {
    startNewFootnote()
    return
  }
  if (command === 'citation') {
    requestCitation()
    return
  }
  if (command === 'math' || command === 'math-block') {
    startNewMath(command === 'math-block')
    return
  }
  editorCommands[command](view.state, view.dispatch)
  focus()
}

/**
 * 右键菜单。先把选区放到点击处：点在图片上选中这张图片；点在当前选区之外时把光标移到点击处
 * （WebKit 会在右键时选中一个词，这里统一为光标，菜单按点击处的结构给出操作）。
 */
const menu = useMenu()

/**
 * 位置是否在选区之内。选中多个表格单元格时按每个单元格判断：这种选区的 from / to 只是其中一个单元格，
 * 在其他选中的单元格上右键也必须保留选区（菜单中的删除行 / 列作用于全部选中的行列）。
 */
function inSelection(selection: Selection, pos: number): boolean {
  return selection.ranges.some((range) => pos >= range.$from.pos && pos <= range.$to.pos)
}

async function openContextMenu(event: MouseEvent): Promise<void> {
  // 图注文本框中是普通文字编辑，不打开正文菜单。
  if (!view || isCaption(event.target)) return
  event.preventDefault()
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (hit) {
    const { doc, selection } = view.state
    const inside = hit.inside >= 0 ? doc.nodeAt(hit.inside) : null
    const onFigure = (event.target as Element).closest?.('.editor-figure') && inside?.type === nodes.figure
    const ref = chapterRefPos(view, event.target) ?? footnotePos(event.target) ?? mathPos(event.target)
    if (ref !== null) view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, ref)))
    else if (onFigure) view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, hit.inside)))
    else if (!inSelection(selection, hit.pos) || selection instanceof NodeSelection) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(hit.pos))))
    }
  }
  await showContextMenu({ x: event.clientX, y: event.clientY }, false)
}

/** Shift+F10 / 菜单键：在光标处打开右键菜单（与章节树相同）。⌘/ 经菜单栏调用 openMenuAtCaret。 */
/** 选中脚注时按 Enter 编辑它（在 ProseMirror 处理 Enter 之前）。 */
function onFootnoteKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing || event.metaKey || event.ctrlKey || !view) return
  const math = selectedMath(view.state)
  if (math) {
    event.preventDefault()
    event.stopPropagation()
    editMath(math.pos)
    return
  }
  const note = selectedFootnote(view.state)
  if (!note) return
  event.preventDefault()
  event.stopPropagation()
  editFootnote(note.pos)
}

function onKeydown(event: KeyboardEvent): void {
  if (isCaption(event.target)) return
  if (matchesShortcut(event, SHORTCUTS.list)) {
    event.preventDefault()
    void openListMenu()
    return
  }
  if (!(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return
  event.preventDefault()
  void openMenuAtCaret()
}

/** 在光标下方打开右键菜单，表格的行列等操作只用键盘也能执行；第一项获得焦点。 */
async function openMenuAtCaret(): Promise<void> {
  if (!view) return
  const caret = view.coordsAtPos(view.state.selection.head)
  await showContextMenu({ x: caret.left, y: caret.bottom }, true)
}

/** 列表快捷键：在光标下方选择类型，打开与取消菜单均不改变正文。 */
async function openListMenu(): Promise<void> {
  if (!view) return
  const chapterId = currentId
  const caret = view.coordsAtPos(view.state.selection.head)
  focus()
  const chosen = await menu.open(listEntries(commandState(view.state)), { x: caret.left, y: caret.bottom }, true)
  if (chosen !== null && currentId === chapterId) runMenuItem(chosen)
}

async function showContextMenu(anchor: MenuAnchor, keyboard: boolean): Promise<void> {
  if (!view) return
  focus()
  const { selection } = view.state
  const onFigure = selection instanceof NodeSelection && selection.node.type === nodes.figure
  const inCode = selection.$from.parent.type === nodes.code_block
  const ref = selectedChapterRef(view.state)
  const entries = editorContextMenu(
    commandState(view.state),
    onFigure ? (selection.node.attrs.alt as string) : null,
    inCode ? fenceLanguage(selection.$from.parent.attrs.params as string) : null,
    ref ? chapterRefMenu(ref.attrs.href as string) : null,
    selectedFootnote(view.state) !== null,
    tableCaptionState(),
    selectedMath(view.state) !== null,
  )
  const chosen = await menu.open(entries, anchor, keyboard)
  if (chosen !== null) runMenuItem(chosen)
}

function runMenuItem(id: string): void {
  const [kind, value] = id.split(':')
  if (kind === 'command') runCommand(value as EditorCommand)
  else if (kind === 'code-language' && view) {
    setCodeLanguage(value ?? '')(view.state, view.dispatch)
    focus()
  }
  else if (id === 'figure:caption' && view) editSelectedCaption(view)
  else if (id === 'math:edit' && view) {
    const math = selectedMath(view.state)
    if (math) editMath(math.pos)
  }
  else if (id === 'table:caption') {
    const pos = tableAtSelection()
    if (pos !== null) editTableCaption(pos)
  }
  else if (id === 'footnote:edit' && view) {
    const note = selectedFootnote(view.state)
    if (note) editFootnote(note.pos)
  }
  else if (kind === 'chapter-ref' && view) {
    const ref = selectedChapterRef(view.state)
    if (value === 'open' && ref) openChapterRef(ref.attrs.href as string)
    else if (value === 'show') {
      setChapterRefShow(id.split(':')[2] as ChapterRefShow)(view.state, view.dispatch)
      focus()
    }
  }
}

/** 光标在表格中时表格是否有标题（右键菜单中“添加 / 编辑表格标题…”）；不在表格中时为 null。 */
function tableCaptionState(): boolean | null {
  const pos = tableAtSelection()
  if (pos === null || !view) return null
  return ((view.state.doc.nodeAt(pos)?.attrs.caption as string | null) ?? '').trim() !== ''
}

/** 选中引用的右键菜单内容：目标的完整名称与当前格式。 */
function chapterRefMenu(href: string) {
  const address = parseChapterRefAddress(href)
  return {
    name: documents.refLabel?.(href)?.name ?? null,
    show: address.kind === 'ref' ? address.show : null,
    citation: address.kind === 'cite',
  }
}

/** 请求选择文献：在光标（或选中的文献引用）下方，选中文献引用时带上它当前的条目。 */
function requestCitation(): void {
  if (!view) return
  const { state } = view
  if (!insertChapterRef('writer:cite/_', '')(state)) return
  const caret = view.coordsAtPos(state.selection.from)
  const ref = selectedChapterRef(state)
  const address = ref ? parseChapterRefAddress(ref.attrs.href as string) : null
  let index = 0
  state.doc.nodesBetween(0, state.selection.from, (node) => {
    if (node.type === nodes.chapter_ref && (node.attrs.href as string).startsWith('writer:cite/')) index++
  })
  emit('request-citation', currentId, {
    anchor: { x: caret.left, y: caret.bottom },
    current: address?.kind === 'cite' ? address.id : null,
    index,
  })
}

/** 请求选择引用目标：在光标（或选中的引用）下方，选中引用时带上它当前的目标与格式。 */
function requestChapterRef(): void {
  if (!view) return
  const { state } = view
  if (!insertChapterRef('writer:chapter/_', '')(state)) return
  const caret = view.coordsAtPos(state.selection.from)
  const ref = selectedChapterRef(state)
  const address = ref ? parseChapterRefAddress(ref.attrs.href as string) : null
  const current =
    address === null
      ? null
      : address.kind === 'ref'
        ? { id: address.id, show: address.show }
        : address.kind === 'element'
          ? { id: null, show: 'number-title' as const, element: { kind: address.element, id: address.id } }
          : { id: null, show: 'number-title' as const }
  emit('request-chapter-ref', currentId, { anchor: { x: caret.left, y: caret.bottom }, current })
}

/**
 * 在光标处插入章节引用（选中引用时更改它）。chapterId 是发起请求时的章节；
 * 期间切换了章节或光标处不能插入时不插入并返回 false。链接文字是当前生成的文字。
 */
function insertChapterRefAt(chapterId: ChapterId, href: string, text?: string): boolean {
  if (!view || chapterId !== currentId) return false
  const cached = documents.refLabel?.(href)?.text ?? text ?? ''
  if (!insertChapterRef(href, cached)(view.state, view.dispatch)) return false
  focus()
  return true
}

function openChapterRef(href: string): void {
  const target = documents.refLabel?.(href)
  if (target) emit('open-chapter', target.id)
}

/** ⌘ + 单击（Windows / Linux：Ctrl + 单击）引用：前往目标章节，不改变选区。 */
function onMousedownCapture(event: MouseEvent): void {
  if (!view || event.button !== 0 || !(IS_MAC ? event.metaKey : event.ctrlKey)) return
  const pos = chapterRefPos(view, event.target)
  if (pos === null) return
  event.preventDefault()
  event.stopPropagation()
  openChapterRef(view.state.doc.nodeAt(pos)!.attrs.href as string)
}

/** 剪贴板或拖入内容中的图片文件。 */
function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) => file.type.startsWith('image/'))
}

/**
 * 脚注的编辑（docs/decisions.md 第 11 节）：插入时先在光标处弹出浮层，完成后才插入（取消不留下空脚注）；
 * 已有脚注双击、单击章末列表中的一条、选中后按 Enter 或右键“编辑脚注…”时编辑。修改是一个可撤销的事务。
 */
const footnoteEditor = shallowRef<{
  readonly chapterId: ChapterId
  /** 编辑的对象：脚注（已有脚注的位置，新脚注为 null）或表格标题（表格的位置）。 */
  readonly target: { readonly kind: 'footnote'; readonly pos: number | null } | { readonly kind: 'table-caption'; readonly pos: number }
  readonly label: string
  readonly placeholder: string
  readonly text: string
  readonly anchor: { readonly x: number; readonly y: number }
} | null>(null)

function startNewFootnote(): void {
  if (!view || !insertFootnote('')(view.state)) return
  const { to } = view.state.selection
  const caret = view.coordsAtPos(to)
  const before = footnotesOf(view.state.doc).filter((note) => note.pos < to).length
  footnoteEditor.value = {
    chapterId: currentId,
    target: { kind: 'footnote', pos: null },
    label: `脚注 ${before + 1}`,
    placeholder: '脚注内容',
    text: '',
    anchor: { x: caret.left, y: caret.bottom },
  }
}

function editFootnote(pos: number): void {
  if (!view) return
  const node = view.state.doc.nodeAt(pos)
  if (node?.type !== nodes.footnote) return
  const dom = view.nodeDOM(pos)
  const rect = dom instanceof Element ? dom.getBoundingClientRect() : null
  const caret = rect ?? view.coordsAtPos(pos)
  footnoteEditor.value = {
    chapterId: currentId,
    target: { kind: 'footnote', pos },
    label: `脚注 ${footnoteNumber(view.state.doc, pos)}`,
    placeholder: '脚注内容',
    text: node.attrs.text as string,
    anchor: { x: caret.left, y: caret.bottom },
  }
}

/** 编辑 pos 处表格的标题（没有标题时添加）。标题出现在导出的表格上方，有标题的表格才有编号、能被引用。 */
function editTableCaption(pos: number): void {
  if (!view) return
  const node = view.state.doc.nodeAt(pos)
  if (node?.type !== nodes.table) return
  const dom = view.dom.querySelector(`[data-table-caption-pos="${pos}"]`) ?? view.nodeDOM(pos)
  const rect = dom instanceof Element ? dom.getBoundingClientRect() : view.coordsAtPos(pos + 1)
  footnoteEditor.value = {
    chapterId: currentId,
    target: { kind: 'table-caption', pos },
    label: '表格标题',
    placeholder: '表格标题',
    text: (node.attrs.caption as string | null) ?? '',
    anchor: { x: rect.left, y: rect.top + 24 },
  }
}

/** 光标所在的表格的位置；不在表格中时为 null。 */
function tableAtSelection(): number | null {
  if (!view) return null
  const { $from } = view.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === nodes.table) return $from.before(depth)
  }
  return null
}

function commitFootnote(text: string): void {
  const editing = footnoteEditor.value
  footnoteEditor.value = null
  if (!view || !editing || editing.chapterId !== currentId) return
  const { target } = editing
  if (target.kind === 'table-caption') {
    setTableCaption(target.pos, text === '' ? null : text)(view.state, view.dispatch)
  } else if (target.pos === null) {
    if (text !== '') insertFootnote(text)(view.state, view.dispatch)
  } else if (text === '') {
    // 清空内容即删除这条脚注。
    view.dispatch(view.state.tr.delete(target.pos, target.pos + 1))
  } else {
    setFootnoteText(target.pos, text)(view.state, view.dispatch)
  }
  focus()
}

function cancelFootnote(): void {
  footnoteEditor.value = null
  focus()
}

/**
 * 公式的编辑（docs/decisions.md 第 14 节）：插入时先在浮层中填写 LaTeX，完成后才插入（取消不留下空公式）；
 * 已有公式双击、选中后按 Enter 或右键“编辑公式…”时编辑；清空即删除。修改是一个可撤销的事务。
 */
const mathEditor = shallowRef<{
  readonly chapterId: ChapterId
  /** 已有公式的位置；新公式为 null。 */
  readonly pos: number | null
  readonly block: boolean
  readonly tex: string
  readonly anchor: { readonly x: number; readonly y: number }
} | null>(null)

function startNewMath(block: boolean): void {
  if (!view || !(block ? insertMathBlock('x') : insertMath('x'))(view.state)) return
  const { from, to } = view.state.selection
  const caret = view.coordsAtPos(to)
  // 选中的文字作为行内公式的初始内容。
  const tex = block ? '' : view.state.doc.textBetween(from, to, ' ', '')
  mathEditor.value = { chapterId: currentId, pos: null, block, tex, anchor: { x: caret.left, y: caret.bottom } }
}

function editMath(pos: number): void {
  if (!view) return
  const node = view.state.doc.nodeAt(pos)
  if (node?.type !== nodes.math && node?.type !== nodes.math_block) return
  const dom = view.nodeDOM(pos)
  const rect = dom instanceof Element ? dom.getBoundingClientRect() : view.coordsAtPos(pos)
  mathEditor.value = {
    chapterId: currentId,
    pos,
    block: node.type === nodes.math_block,
    tex: node.attrs.tex as string,
    anchor: { x: rect.left, y: rect.bottom },
  }
}

function commitMath(tex: string): void {
  const editing = mathEditor.value
  mathEditor.value = null
  if (!view || !editing || editing.chapterId !== currentId) return
  if (editing.pos === null) {
    if (tex !== '') (editing.block ? insertMathBlock(tex) : insertMath(tex))(view.state, view.dispatch)
  } else if (tex === '') {
    const node = view.state.doc.nodeAt(editing.pos)
    if (node) view.dispatch(view.state.tr.delete(editing.pos, editing.pos + node.nodeSize))
  } else {
    setMath(editing.pos, tex)(view.state, view.dispatch)
  }
  focus()
}

function cancelMath(): void {
  mathEditor.value = null
  focus()
}

/** 点在公式上时它在文档中的位置。 */
function mathPos(target: EventTarget | null): number | null {
  if (!view || !(target instanceof Element)) return null
  const dom = target.closest('.math-inline, .math-block')
  if (!dom || !view.dom.contains(dom)) return null
  const pos = view.posAtDOM(dom, 0)
  const node = view.state.doc.nodeAt(pos)
  return node?.type === nodes.math || node?.type === nodes.math_block ? pos : null
}

/** 点在脚注上时它在文档中的位置。 */
function footnotePos(target: EventTarget | null): number | null {
  if (!view || !(target instanceof Element)) return null
  const dom = target.closest('.footnote-ref')
  if (!dom || !view.dom.contains(dom)) return null
  const pos = view.posAtDOM(dom, 0)
  return view.state.doc.nodeAt(pos)?.type === nodes.footnote ? pos : null
}

/** 双击脚注编辑；单击章末脚注列表中的一条编辑它。 */
function onFootnoteClick(event: MouseEvent): void {
  if (!view || !(event.target instanceof Element)) return
  const item = event.target.closest<HTMLElement>('[data-footnote-pos]')
  if (item && event.detail === 1) {
    event.preventDefault()
    editFootnote(Number(item.dataset.footnotePos))
    return
  }
  const tableCaption = event.target.closest<HTMLElement>('[data-table-caption-pos]')
  if (tableCaption && event.detail === 1) {
    event.preventDefault()
    editTableCaption(Number(tableCaption.dataset.tableCaptionPos))
    return
  }
  if (event.detail !== 2) return
  const math = mathPos(event.target)
  if (math !== null) {
    event.preventDefault()
    editMath(math)
    return
  }
  const pos = footnotePos(event.target)
  if (pos === null) return
  event.preventDefault()
  editFootnote(pos)
}

function isCaption(target: EventTarget | null): boolean {
  return target instanceof Element && target.classList.contains('editor-figure__caption-input')
}

/**
 * 在光标处插入图片。chapterId 是发起请求时的章节；
 * 若期间已切换到其他章节（或光标处不能插入）则不插入并返回 false，由调用方另行处理，避免插错位置。
 */
function insertImageAt(chapterId: ChapterId, reference: string, alt: string): boolean {
  if (!view || chapterId !== currentId) return false
  if (!insertImage(reference, alt)(view.state, view.dispatch)) return false
  focus()
  return true
}

/**
 * 从编辑器之外（如章节树中按 Enter）把焦点交给正文，光标与滚动位置都保持原样。
 * 焦点来自别处时正文中还没有 DOM 选区，WebKit 聚焦时会先把光标放到正文开头并滚动到顶部，
 * 随后 ProseMirror 才恢复真正的选区（不滚动），因此聚焦前后保持滚动位置不变。
 */
function focus(): void {
  if (!view || !scroller.value) return
  const top = scroller.value.scrollTop
  view.focus()
  scroller.value.scrollTop = top
}

/** 正文顶层块的 DOM（与文档中的顶层节点一一对应）。 */
function blockElements(editorView: EditorView): Element[] {
  const elements: Element[] = []
  editorView.state.doc.forEach((_node, offset) => {
    const dom = editorView.nodeDOM(offset)
    if (dom instanceof Element) elements.push(dom)
  })
  return elements
}

/** 视口顶端所在的位置（进入全文阅读时从这里接着显示）。 */
function readingPosition(): BlockPosition {
  if (!view || !scroller.value || !heading.value) return { block: -1, offset: 0 }
  const top = scroller.value.getBoundingClientRect().top
  const title = heading.value.getBoundingClientRect()
  if (title.bottom > top) return { block: -1, offset: title.top - top }
  return topBlock(blockElements(view), top) ?? { block: -1, offset: 0 }
}

/**
 * 从全文阅读回来：把该位置滚到与阅读时相同的高度，光标放在视口中第一个完整显示的块的开头，
 * 接着输入时正文不会跳到别处。
 */
/** 选中章节中第 index 个引用（从 0 开始）并滚动到可见，正文获得焦点（如从失效引用列表跳过来）。 */
function selectChapterRef(chapterId: ChapterId, index: number): void {
  if (!view || chapterId !== currentId) return
  let found = -1
  let count = 0
  view.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type === nodes.chapter_ref && count++ === index) found = pos
    return true
  })
  if (found < 0) return
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, found)).scrollIntoView())
  focus()
}

/** 前往章节（如从引用跳转过来）：光标放在正文开头，滚动到顶部，正文获得焦点。 */
function revealStart(chapterId: ChapterId): void {
  if (!view || !scroller.value || chapterId !== currentId) return
  view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)))
  scroller.value.scrollTop = 0
  focus()
  scroller.value.scrollTop = 0
}

function revealPosition(position: BlockPosition): void {
  if (!view || !scroller.value) return
  const blocks = blockElements(view)
  const target = position.block < 0 ? heading.value : blocks[Math.min(position.block, blocks.length - 1)]
  if (!target) return
  const top = scroller.value.getBoundingClientRect().top
  scroller.value.scrollTop += target.getBoundingClientRect().top - top - position.offset
  const viewportTop = scroller.value.getBoundingClientRect().top
  const first = blocks.findIndex((block) => block.getBoundingClientRect().top >= viewportTop - 1)
  if (first < 0) return
  let start = 0
  view.state.doc.forEach((node, offset, index) => {
    if (index === first) start = offset
  })
  view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(start), 1)))
}

/**
 * 查找：选中当前章节中选区之后（之前）的下一个匹配并滚动到可见，不改变焦点（焦点通常在查找栏中）。
 * where 为 'first' / 'last' 时选中第一个 / 最后一个匹配。没有可选的匹配时返回 false。
 */
function selectMatch(where: 'next' | 'previous' | 'first' | 'last'): boolean {
  if (!view) return false
  const matches = currentMatches(view.state)
  const { selection } = view.state
  const index =
    where === 'first' ? 0
    : where === 'last' ? matches.length - 1
    : where === 'next' ? nextMatchIndex(matches, selection)
    : previousMatchIndex(matches, selection)
  const match = matches[index]
  if (!match) return false
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).scrollIntoView())
  return true
}

/** 选区恰好是一个匹配时把它替换为 replacement（一次可撤销的修改），返回是否替换了。 */
function replaceSelectedMatch(replacement: string): boolean {
  if (!view) return false
  const matches = currentMatches(view.state)
  const index = selectedMatchIndex(matches, view.state.selection)
  if (index < 0) return false
  view.dispatch(replaceMatches(view.state, [matches[index]], replacement).scrollIntoView())
  return true
}

/**
 * 把一个章节中全部匹配替换为 replacement，返回替换的数量。当前章节在编辑器中修改；
 * 其他章节在它们各自缓存的编辑器状态上修改（进入该章节自己的撤销历史），新正文以 change 发出。
 */
function replaceAllIn(chapterId: ChapterId, text: string, query: string, replacement: string): number {
  if (!view || query === '') return 0
  if (chapterId === currentId) {
    const matches = findMatches(view.state.doc, query)
    if (matches.length > 0) view.dispatch(replaceMatches(view.state, matches, replacement))
    return matches.length
  }
  const state = documents.stateFor(chapterId, text)
  const matches = findMatches(state.doc, query)
  if (matches.length === 0) return 0
  const next = documents.update(chapterId, state.apply(replaceMatches(state, matches, replacement)))
  if (next !== null) emit('change', chapterId, next)
  return matches.length
}

/**
 * 给一个章节中第 index 个有编号的图（或表）设置标识（第一次被引用时）。当前章节在编辑器中修改；
 * 其他章节在它们缓存的编辑器状态上修改，新正文以 change 发出。已有标识或找不到时不改变。
 */
function assignElementId(chapterId: ChapterId, text: string, kind: 'figure' | 'table', index: number, id: string): void {
  if (!view) return
  if (chapterId === currentId) {
    setElementId(kind, index, id)(view.state, view.dispatch)
    return
  }
  const state = documents.stateFor(chapterId, text)
  setElementId(kind, index, id)(state, (tr) => {
    const next = documents.update(chapterId, state.apply(tr))
    if (next !== null) emit('change', chapterId, next)
  })
}

/** 选中的文字（只取一行），用于预先填入查找词。 */
function selectedText(): string {
  if (!view) return ''
  const { from, to } = view.state.selection
  return view.state.doc.textBetween(from, to, '\n', '').split('\n')[0]
}

defineExpose({
  assignElementId,
  selectMatch,
  replaceSelectedMatch,
  replaceAllIn,
  selectedText,
  readingPosition,
  revealPosition,
  insertImage: insertImageAt,
  insertChapterRef: insertChapterRefAt,
  revealStart,
  selectChapterRef,
  /** 更新交叉引用后采用等价的新正文，不改变编辑器状态（见 ChapterDocuments.adopt）。 */
  adoptContent: (chapterId: ChapterId, text: string) => documents.adopt(chapterId, text),
  runCommand,
  openMenuAtCaret,
  openListMenu,
  /** 当前的 EditorView（测试与调试用）。 */
  getView: (): EditorView | null => view,
  focus,
})
</script>

<template>
  <div class="chapter-editor" :style="themeStyle">
    <div ref="scroller" class="chapter-editor__scroller">
      <h1 ref="heading" class="chapter-editor__heading document-heading">
        <span class="document-heading__number">{{ number }}</span>
        <span :class="{ 'document-heading__title--untitled': !title }">
          {{ title || '未命名章节' }}
        </span>
      </h1>
      <div class="chapter-editor__body" @mousedown.capture="onMousedownCapture">
        <div
          ref="mountPoint"
          class="chapter-editor__mount"
          @contextmenu="openContextMenu"
          @keydown="onKeydown"
          @keydown.capture="onFootnoteKeydown"
          @click="onFootnoteClick"
        ></div>
      </div>
    </div>
    <MathPopover
      v-if="mathEditor"
      :anchor="mathEditor.anchor"
      :label="mathEditor.block ? '公式块' : '行内公式'"
      :tex="mathEditor.tex"
      :display="mathEditor.block"
      @commit="commitMath"
      @cancel="cancelMath"
    />
    <TextPopover
      v-if="footnoteEditor"
      :anchor="footnoteEditor.anchor"
      :label="footnoteEditor.label"
      :placeholder="footnoteEditor.placeholder"
      :text="footnoteEditor.text"
      @commit="commitFootnote"
      @cancel="cancelFootnote"
    />
    <PopupMenu
      v-if="menu.current.value"
      label="正文操作"
      :items="menu.current.value.entries"
      :anchor="menu.current.value.anchor"
      :keyboard="menu.current.value.keyboard"
      @select="menu.select"
      @close="menu.close"
    />
  </div>
</template>

<style scoped>
.chapter-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg);
}

.chapter-editor__scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 总是为滚动条留位：与全文阅读切换时（一个有滚动条、一个没有）版心不左右移动。 */
  scrollbar-gutter: stable;
}

/*
 * 章节标题是这一页的开头，随正文一起滚动，不占用固定的界面区域。
 * 它按在文档中的层级使用对应级别的标题样式（document_body.css），与正文共用版心。
 */
.chapter-editor__heading {
  max-width: var(--doc-column);
  box-sizing: border-box;
  margin: 0 auto;
  padding: calc(var(--space-10) + var(--space-6)) var(--doc-gutter) var(--space-4);
  /* 标题只能在章节树中修改，这里不可选中编辑，避免被误认为正文的一部分。 */
  -webkit-user-select: none;
  user-select: none;
}

/*
 * 正文的展示在 document_body.css（与全文阅读共用）；这里是版心与编辑才有的状态。
 * ProseMirror 生成的 DOM 不带 scoped 属性，因此用 :deep。
 */
.chapter-editor__body :deep(.chapter-editor__content) {
  max-width: var(--doc-column);
  box-sizing: border-box;
  margin: 0 auto;
  /* 下方留出大段空白：写到最后一段时仍可以把它滚到视线高度，而不是贴着窗口底边。 */
  padding: var(--space-7) var(--doc-gutter) 40vh;
  /* 文字光标由 caret.ts 自绘（WebKit 的原生光标在段落第二行起高度不对）；输入法组字期间用原生光标。 */
  caret-color: transparent;
  outline: none;
}

.chapter-editor__body :deep(.chapter-editor__content.is-composing) {
  caret-color: var(--color-doc-text);
}

.chapter-editor__body {
  position: relative;
}

/* 自绘光标与选区以 ProseMirror 视图的父元素为坐标原点。 */
.chapter-editor__mount {
  position: relative;
}

.chapter-editor__body :deep(.editor-caret) {
  position: absolute;
  width: 1.5px;
  background: var(--color-doc-text);
  pointer-events: none;
  animation: editor-caret-blink 1.1s steps(1) infinite;
}

@keyframes editor-caret-blink {
  50% {
    visibility: hidden;
  }
}

/* 选区底色由 selection.ts 按行自绘（WebKit 的原生底色从段落中间开始选择时第一行偏高）。 */
.chapter-editor__body :deep(.chapter-editor__content ::selection) {
  background: transparent;
}

.chapter-editor__body :deep(.editor-selection__box) {
  position: absolute;
  background: var(--color-doc-selection);
  mix-blend-mode: var(--color-doc-selection-blend);
  pointer-events: none;
}

.chapter-editor__body :deep(.editor-selection.is-inactive .editor-selection__box) {
  background: var(--color-doc-selection-inactive);
}

.chapter-editor__body :deep(.is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--color-text-tertiary);
  pointer-events: none;
}

/*
 * 指针移入或光标在表格中（is-active，plugins.ts）时用内阴影淡淡显示单元格边界，编辑时看得清格子；
 * 不用透明边框，它们在折叠边框的交点处留下断痕，也不改变布局。
 */
.chapter-editor__body :deep(th),
.chapter-editor__body :deep(td) {
  transition: box-shadow var(--duration-base) var(--ease-out);
}

.chapter-editor__body :deep(table:is(:hover, .is-active) tr > * + *) {
  box-shadow: inset 1px 0 0 var(--color-doc-cell-hint);
}

.chapter-editor__body :deep(table:is(:hover, .is-active) tr:nth-child(n + 3) > td) {
  box-shadow:
    inset 1px 0 0 var(--color-doc-cell-hint),
    inset 0 1px 0 var(--color-doc-cell-hint);
}

.chapter-editor__body :deep(table:is(:hover, .is-active) tr:nth-child(n + 3) > td:first-child) {
  box-shadow: inset 0 1px 0 var(--color-doc-cell-hint);
}

.chapter-editor__body :deep(.selectedCell::after) {
  position: absolute;
  inset: 0;
  content: '';
  background: var(--color-accent-fill);
  pointer-events: none;
}

/*
 * 图注（image_view.ts）是一个随内容增高的文本框：隐藏的同内容 ::after
 * 与文本框放在同一网格格中撑开高度。没有图注时只在选中图片或编辑时显示“添加图注”。
 */
.chapter-editor__body :deep(.editor-figure__caption-row) {
  display: flex;
  justify-content: center;
  align-items: baseline;
}

/* 图注随内容变宽，与前面的编号一起居中。 */
.chapter-editor__body :deep(.editor-figure__caption) {
  display: grid;
  flex: 0 1 auto;
  min-width: 6em;
}

/* 有编号时图注紧接在编号之后（不按最小宽度居中留出空隙）。 */
.chapter-editor__body :deep(.editor-figure__caption-row.has-label .editor-figure__caption) {
  min-width: 1em;
}

.chapter-editor__body :deep(.editor-figure__caption-row.has-label .editor-figure__caption::after),
.chapter-editor__body :deep(.editor-figure__caption-row.has-label .editor-figure__caption-input) {
  padding-left: 0;
  text-align: left;
}

/* 图的编号（“图 2-1”）：与图注同字号，次级颜色，不可编辑。 */
.chapter-editor__body :deep(.editor-figure__caption-label) {
  flex: none;
  padding: var(--space-1) 0;
  color: var(--color-doc-muted);
  white-space: nowrap;
  -webkit-user-select: none;
  user-select: none;
}

.chapter-editor__body :deep(.editor-figure:not(.has-caption, .ProseMirror-selectednode, .is-editing) .editor-figure__caption-row) {
  display: none;
}

/* 表格标题（表格上方，单击编辑）。 */
.chapter-editor__body :deep(.table-caption) {
  cursor: pointer;
}

.chapter-editor__body :deep(.table-caption:hover) {
  color: var(--color-doc-text);
}

.chapter-editor__body :deep(.editor-figure__caption::after),
.chapter-editor__body :deep(.editor-figure__caption-input) {
  grid-area: 1 / 1;
  box-sizing: border-box;
  margin: 0;
  padding: var(--space-1) var(--space-3);
  border: none;
  font: inherit;
  text-align: center;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chapter-editor__body :deep(.editor-figure__caption::after) {
  content: attr(data-value) ' ';
  visibility: hidden;
}

.chapter-editor__body :deep(.editor-figure__caption-input) {
  /* 宽度只由同内容的 ::after 决定（文本框自身的默认宽度不撑开图注）。 */
  width: 0;
  min-width: 100%;
  overflow: hidden;
  resize: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: inherit;
  /* 正文的文字光标是自绘的（caret-color 为透明），图注文本框用原生光标与选区底色。 */
  caret-color: var(--color-doc-text);
  outline: none;
  cursor: text;
}

/* 只在编辑时显示文本框中的选区：选中整张图片时正文选区也包住图注，不应把图注画成已选中的文字。 */
.chapter-editor__body :deep(.editor-figure__caption-input:focus::selection) {
  background: var(--color-doc-selection);
}

.chapter-editor__body :deep(.editor-figure__caption-input::placeholder) {
  color: var(--color-text-tertiary);
}

.chapter-editor__body :deep(.editor-figure__caption-input:focus) {
  background: var(--color-fill-hover);
}

/*
 * 图片是可拖动的原子节点：WebKit 中，在可拖动但允许文字选择的元素上按下鼠标会开始原生文字选择，
 * 起点落在图片之前的文字里，稍一移动就选中图片上方的文字。图片不可文字选择，按下只由 ProseMirror 选中图片
 * （拖动本身由 figure_editing.ts 取消）；图注文本框仍可选择文字。
 */
.chapter-editor__body :deep(.editor-image) {
  -webkit-user-select: none;
  user-select: none;
}

.chapter-editor__body :deep(.editor-figure__caption-input) {
  -webkit-user-select: text;
  user-select: text;
}

/* 章节引用是一个整体：不可文字选择，单击整体选中，选中时与选中的文字同样着色。 */
.chapter-editor__body :deep(.chapter-ref) {
  -webkit-user-select: none;
  user-select: none;
  cursor: default;
}

.chapter-editor__body :deep(.chapter-ref.ProseMirror-selectednode) {
  outline: none;
  border-radius: 2px;
  background: var(--color-doc-selection);
}

/* 查找的匹配（find.ts）：全部匹配淡黄底色，当前匹配更深。 */
.chapter-editor__body :deep(.find-match) {
  border-radius: 2px;
  background: var(--color-doc-find);
}

.chapter-editor__body :deep(.find-match.is-current) {
  background: var(--color-doc-find-current);
}

/* 选中的图片只在图片本身外画一个框（不用 ProseMirror 默认画在外层容器上的框）。 */
.chapter-editor__body :deep(.editor-image.ProseMirror-selectednode) {
  outline: none;
}

.chapter-editor__body :deep(.editor-image.ProseMirror-selectednode img),
.chapter-editor__body :deep(.editor-image.ProseMirror-selectednode .editor-image__missing) {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
</style>
