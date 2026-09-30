<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EditorView } from 'prosemirror-view'
import { NodeSelection, TextSelection, type EditorState, type Selection, type Transaction } from 'prosemirror-state'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { ChapterDocuments } from './chapter_documents.ts'
import { commandState, editorCommands, insertImage, type CommandState, type EditorCommand } from './commands.ts'
import { editorContextMenu } from './editor_menu.ts'
import { nodes } from './schema.ts'
import PopupMenu, { type MenuAnchor } from '../common/PopupMenu.vue'
import { useMenu } from '../common/use_menu.ts'
import { figureNodeView, imageNodeView, type ImageResolver } from './image_view.ts'
import ImageLayoutControls from './ImageLayoutControls.vue'
import {
  layoutChanges,
  selectedFigure,
  setFigureLayout,
  syncImageLayouts,
  type SelectedFigure,
} from './image_layout.ts'
import {
  THEMES,
  type DocumentTheme,
  type ImageAlign,
  type ImageLayouts,
  type ImageOverride,
  type ImageSize,
} from '../../domain/document_style/document_style.ts'
import { editorHeadingVars, themeCssVars } from '../document_style/theme_css.ts'

/**
 * 章节正文编辑器：ProseMirror 结构化编辑，正文仍以 Markdown 保存（docs/decisions.md 第 2 节）。
 *
 * - 整个组件只有一个 EditorView；切换章节时换入该章节缓存的 EditorState（撤销历史、选区仍在），不重建视图。
 * - 只有文档真正改变时才发出 change；change 携带事务发生时的章节 id，切换章节后不会写错章节。
 * - 父组件把 change 回传为 content 时不做任何事；只有与编辑器不一致的 content（外部修改）才替换文档。
 * - 章节标题与编号只显示在编辑器上方，不进入正文。
 * - 文档主题以 CSS 变量作用在外层元素上：主题变化不改变文档、不产生 change、不进入撤销历史、不重建视图。
 * - 图片布局按图片文件键属于文档样式（image_layout.ts）：修改时发出 image-layout，可撤销；不产生 change。
 * - 编辑器自己没有工具栏：命令的可用 / 勾选状态以 tools 发出，由工作区的工具栏与菜单栏显示，
 *   它们通过 runCommand 执行命令。选中的图片旁直接显示布局按钮；右键菜单列出与点击处相关的操作。
 */
const props = defineProps<{
  chapterId: ChapterId
  content: string
  /** 章节编号的显示文本，如 "2.1"。 */
  number: string
  title: string
  /** 正文中图片引用的显示地址；不提供时图片显示为占位。 */
  resolveImage?: ImageResolver
  /** 文档主题（已解析）；不提供时使用默认主题。 */
  theme?: DocumentTheme
  /** 图片文件键 → 布局；不提供时所有图片跟随主题。 */
  imageLayouts?: ImageLayouts
}>()

const emit = defineEmits<{
  change: [chapterId: ChapterId, text: string]
  /** 用户点击了"插入图片"；由上层选择并导入图片后调用 insertImage。 */
  'request-image': [chapterId: ChapterId]
  /** 用户（或撤销 / 重做）修改了一张图片的布局；null 表示跟随主题。 */
  'image-layout': [key: string, layout: ImageOverride | null]
  /** 编辑命令的可用 / 勾选状态与选中的图片（由上层的工具栏与菜单栏显示）。 */
  tools: [state: CommandState, figure: SelectedFigure | null]
}>()

/** 滚动容器（每个章节记住自己的滚动位置）。 */
const scroller = ref<HTMLElement | null>(null)
const mountPoint = ref<HTMLElement | null>(null)
const tools = shallowRef<CommandState | null>(null)
/** 选中的独立成段的图片：显示布局按钮。 */
const figure = shallowRef<SelectedFigure | null>(null)

const theme = computed(() => props.theme ?? THEMES.book)
const EMPTY_LAYOUTS: ImageLayouts = new Map()
const layouts = computed(() => props.imageLayouts ?? EMPTY_LAYOUTS)
/** 章节层级：决定章节标题与正文标题使用哪一级标题样式。 */
const depth = computed(() => Math.max(1, props.number.split('.').filter(Boolean).length))
const themeStyle = computed(() => ({ ...themeCssVars(theme.value), ...editorHeadingVars(depth.value) }))

const documents = new ChapterDocuments()
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
  for (const change of layoutChanges(tr)) emit('image-layout', change.key, change.layout)
}

function showState(state: EditorState): void {
  const next = commandState(state)
  const selected = selectedFigure(state)
  // 只在变化时更新：输入文字时命令状态通常不变，上层不必每次按键都重新渲染。
  let changed = false
  if (!sameTools(tools.value, next)) {
    tools.value = next
    changed = true
  }
  if (JSON.stringify(figure.value) !== JSON.stringify(selected)) {
    figure.value = selected
    changed = true
  }
  if (selected) void placeFigureControls()
  if (changed) emit('tools', next, selected)
}

function sameTools(a: CommandState | null, b: CommandState): boolean {
  if (a === null) return false
  return (Object.keys(b) as EditorCommand[]).every(
    (key) => a[key].enabled === b[key].enabled && a[key].active === b[key].active,
  )
}

/**
 * 选中图片时的布局按钮：浮在图片上方居中，随正文一起滚动（定位在正文容器内）。
 * 上方已经滚出可见区域时放在图片内部的上沿。图片尺寸变化（改变布局、窗口宽度）时跟随。
 */
const figureControls = ref<InstanceType<typeof ImageLayoutControls> | null>(null)
const controlsPosition = shallowRef<{ left: number; top: number } | null>(null)
const CONTROLS_GAP = 8
let observedFigure: Element | null = null
const figureObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => void placeFigureControls())

function selectedFigureElement(): HTMLElement | null {
  if (!view || !(view.state.selection instanceof NodeSelection)) return null
  const dom = view.nodeDOM(view.state.selection.from)
  if (!(dom instanceof HTMLElement)) return null
  return dom.querySelector<HTMLElement>('img, .editor-image__missing') ?? dom
}

async function placeFigureControls(): Promise<void> {
  await nextTick()
  const target = selectedFigureElement()
  const body = mountPoint.value?.parentElement
  if (!target || !body || !figure.value) {
    controlsPosition.value = null
    return
  }
  if (observedFigure !== target) {
    if (observedFigure) figureObserver?.unobserve(observedFigure)
    observedFigure = target
    figureObserver?.observe(target)
  }
  const box = target.getBoundingClientRect()
  const origin = body.getBoundingClientRect()
  const visibleTop = scroller.value?.getBoundingClientRect().top ?? origin.top
  const height = (figureControls.value?.$el as HTMLElement | undefined)?.offsetHeight ?? 0
  const fitsAbove = box.top - height - CONTROLS_GAP >= visibleTop
  controlsPosition.value = {
    left: box.left - origin.left + box.width / 2,
    top: (fitsAbove ? box.top - height - CONTROLS_GAP : box.top + CONTROLS_GAP) - origin.top,
  }
}

watch(figure, (selected) => {
  if (selected) return
  controlsPosition.value = null
  if (observedFigure) figureObserver?.unobserve(observedFigure)
  observedFigure = null
})


/** 章节的编辑器状态，并同步当前的图片布局（缓存的状态可能是在其他章节修改布局之前的）。 */
function stateFor(chapterId: ChapterId, text: string): EditorState {
  const state = documents.stateFor(chapterId, text)
  const sync = syncImageLayouts(state, layouts.value, theme.value.image)
  if (!sync) return state
  const synced = state.apply(sync)
  documents.update(chapterId, synced)
  return synced
}

onMounted(() => {
  const state = stateFor(currentId, props.content)
  const resolveImage = props.resolveImage ?? (() => null)
  view = new EditorView(mountPoint.value!, {
    state,
    dispatchTransaction,
    scrollThreshold: CARET_MARGIN,
    scrollMargin: CARET_MARGIN,
    nodeViews: { image: imageNodeView(resolveImage), figure: figureNodeView(resolveImage) },
    attributes: { class: 'chapter-editor__content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '正文' },
  })
  showState(state)
})

onBeforeUnmount(() => {
  figureObserver?.disconnect()
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
      const next = stateFor(chapterId, text)
      view.updateState(next)
      showState(next)
      scroller.value.scrollTop = reused ? (scrolls.get(chapterId) ?? 0) : 0
      return
    }
    if (documents.isCurrent(chapterId, text)) return
    // 外部修改了当前章节正文：整体替换，仍保留在撤销历史中；以新正文为基准，不回发 change。
    const doc = documents.rebase(chapterId, text)
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content))
  },
)

// 主题或图片布局在编辑器之外改变（样式面板、撤销后写回的布局）：同步进当前状态，不进入撤销历史。
watch([layouts, () => theme.value.image], () => {
  if (!view) return
  const sync = syncImageLayouts(view.state, layouts.value, theme.value.image)
  if (sync) view.dispatch(sync)
})

function changeFigureLayout(patch: ImageOverride): void {
  if (!view) return
  setFigureLayout(patch)(view.state, view.dispatch)
}

function runCommand(command: EditorCommand): void {
  if (!view) return
  if (command === 'image') {
    emit('request-image', currentId)
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
  if (!view) return
  event.preventDefault()
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (hit) {
    const { doc, selection } = view.state
    const inside = hit.inside >= 0 ? doc.nodeAt(hit.inside) : null
    const onFigure = (event.target as Element).closest?.('.editor-figure') && inside?.type === nodes.figure
    if (onFigure) view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, hit.inside)))
    else if (!inSelection(selection, hit.pos) || selection instanceof NodeSelection) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(hit.pos))))
    }
  }
  await showContextMenu({ x: event.clientX, y: event.clientY }, false)
}

/** Shift+F10 / 菜单键：在光标处打开右键菜单（与章节树相同）。⌘/ 经菜单栏调用 openMenuAtCaret。 */
function onKeydown(event: KeyboardEvent): void {
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

async function showContextMenu(anchor: MenuAnchor, keyboard: boolean): Promise<void> {
  if (!view) return
  focus()
  const entries = editorContextMenu(commandState(view.state), selectedFigure(view.state))
  const chosen = await menu.open(entries, anchor, keyboard)
  if (chosen !== null) runMenuItem(chosen)
}

function runMenuItem(id: string): void {
  const [kind, value] = id.split(':')
  if (kind === 'command') runCommand(value as EditorCommand)
  else if (kind === 'image-size') changeFigureLayout({ size: value as ImageSize })
  else if (kind === 'image-align') changeFigureLayout({ align: value as ImageAlign })
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

defineExpose({
  insertImage: insertImageAt,
  runCommand,
  changeFigureLayout,
  openMenuAtCaret,
  /** 当前的 EditorView（测试与调试用）。 */
  getView: (): EditorView | null => view,
  focus,
})
</script>

<template>
  <div class="chapter-editor" :style="themeStyle">
    <div ref="scroller" class="chapter-editor__scroller">
      <h1 class="chapter-editor__heading">
        <span class="chapter-editor__number">{{ number }}</span>
        <span class="chapter-editor__title" :class="{ 'chapter-editor__title--untitled': !title }">
          {{ title || '未命名章节' }}
        </span>
      </h1>
      <div class="chapter-editor__body">
        <div ref="mountPoint" class="chapter-editor__mount" @contextmenu="openContextMenu" @keydown="onKeydown"></div>
        <ImageLayoutControls
          v-if="figure"
          ref="figureControls"
          class="chapter-editor__figure-controls"
          :class="{ 'chapter-editor__figure-controls--placed': controlsPosition }"
          :style="controlsPosition ? { left: `${controlsPosition.left}px`, top: `${controlsPosition.top}px` } : undefined"
          :layout="figure.layout"
          @change="changeFigureLayout"
        />
      </div>
    </div>
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
}

/*
 * 章节标题是这一页的开头，随正文一起滚动，不占用固定的界面区域。
 * 它按在文档中的层级使用主题的标题样式，与正文共用版心。
 */
.chapter-editor__heading {
  max-width: var(--doc-column);
  box-sizing: border-box;
  margin: 0 auto;
  padding: var(--space-10) var(--doc-gutter) 0;
  font-family: var(--heading-font);
  font-size: var(--heading-size);
  font-weight: bold;
  line-height: 1.4;
  color: var(--color-doc-text);
  overflow-wrap: anywhere;
  /* 标题只能在章节树中修改，这里不可选中编辑，避免被误认为正文的一部分。 */
  -webkit-user-select: none;
  user-select: none;
}

.chapter-editor__number {
  margin-right: 0.6em;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.chapter-editor__title--untitled {
  color: var(--color-text-tertiary);
}

/*
 * 正文排版：字体、字号、行距、段距、标题、引用、代码、表格、图注与图片布局
 * 都来自文档主题的 CSS 变量（ui/document_style/theme_css.ts）。
 * ProseMirror 生成的 DOM 不带 scoped 属性，因此用 :deep。
 */
.chapter-editor__body :deep(.chapter-editor__content) {
  max-width: var(--doc-column);
  box-sizing: border-box;
  margin: 0 auto;
  /* 下方留出大段空白：写到最后一段时仍可以把它滚到视线高度，而不是贴着窗口底边。 */
  padding: var(--space-5) var(--doc-gutter) 40vh;
  font-family: var(--doc-body-font);
  font-size: var(--doc-body-size);
  line-height: var(--doc-line-height);
  color: var(--color-doc-text);
  /* 应用界面关闭了字体合成（App.vue）；正文要像 Word / PDF 一样为没有斜体、粗体字形的中文字体合成斜体与粗体。 */
  font-synthesis: weight style;
  /* 文字光标由 caret.ts 自绘（WebKit 的原生光标在段落第二行起高度不对）；输入法组字期间用原生光标。 */
  caret-color: transparent;
  outline: none;
  overflow-wrap: anywhere;
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

/*
 * 选中图片的布局按钮：浮在图片上方居中的一条紧凑按钮组。它是浮在正文之上的层，因此有阴影；
 * 第一次测量位置前不可见，避免在错误的位置闪一下。
 */
.chapter-editor__figure-controls {
  position: absolute;
  z-index: 2;
  visibility: hidden;
  transform: translateX(-50%);
}

.chapter-editor__figure-controls--placed {
  visibility: visible;
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
  mix-blend-mode: multiply;
  pointer-events: none;
}

.chapter-editor__body :deep(.editor-selection.is-inactive .editor-selection__box) {
  background: var(--color-doc-selection-inactive);
}

.chapter-editor__body :deep(p) {
  margin: var(--doc-paragraph-spacing) 0;
}

.chapter-editor__body :deep(.is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--color-text-tertiary);
  pointer-events: none;
}

/* 正文中的 # … ######：叠加在章节层级之下，--md-hN-* 由组件按章节层级映射到主题的标题样式。 */
.chapter-editor__body :deep(h1),
.chapter-editor__body :deep(h2),
.chapter-editor__body :deep(h3),
.chapter-editor__body :deep(h4),
.chapter-editor__body :deep(h5),
.chapter-editor__body :deep(h6) {
  line-height: 1.4;
}

.chapter-editor__body :deep(h1) {
  margin: var(--md-h1-before) 0 var(--md-h1-after);
  font-family: var(--md-h1-font);
  font-size: var(--md-h1-size);
}

.chapter-editor__body :deep(h2) {
  margin: var(--md-h2-before) 0 var(--md-h2-after);
  font-family: var(--md-h2-font);
  font-size: var(--md-h2-size);
}

.chapter-editor__body :deep(h3) {
  margin: var(--md-h3-before) 0 var(--md-h3-after);
  font-family: var(--md-h3-font);
  font-size: var(--md-h3-size);
}

.chapter-editor__body :deep(h4) {
  margin: var(--md-h4-before) 0 var(--md-h4-after);
  font-family: var(--md-h4-font);
  font-size: var(--md-h4-size);
}

.chapter-editor__body :deep(h5) {
  margin: var(--md-h5-before) 0 var(--md-h5-after);
  font-family: var(--md-h5-font);
  font-size: var(--md-h5-size);
}

.chapter-editor__body :deep(h6) {
  margin: var(--md-h6-before) 0 var(--md-h6-after);
  font-family: var(--md-h6-font);
  font-size: var(--md-h6-size);
}

.chapter-editor__body :deep(blockquote) {
  margin: 1em 0;
  padding: 0 1em;
  border-left: 3px solid var(--color-doc-rule);
  color: var(--color-doc-muted);
  font-family: var(--doc-quote-font);
  font-size: var(--doc-quote-size);
}

.chapter-editor__body :deep(ul),
.chapter-editor__body :deep(ol) {
  margin: 0.6em 0;
  padding-left: 1.6em;
}

.chapter-editor__body :deep(li > ul),
.chapter-editor__body :deep(li > ol) {
  margin: 0;
}

/* 紧凑列表：列表项之间没有段落间距（与 Markdown 渲染一致）。 */
.chapter-editor__body :deep(ul:not([data-loose]) > li > p),
.chapter-editor__body :deep(ol:not([data-loose]) > li > p) {
  margin: 0;
}

.chapter-editor__body :deep(li[data-task]) {
  position: relative;
  list-style: none;
}

.chapter-editor__body :deep(li[data-task]::before) {
  position: absolute;
  left: -1.3em;
  content: '☐';
  color: var(--color-text-tertiary);
}

.chapter-editor__body :deep(li[data-task='done']::before) {
  content: '☑';
}

.chapter-editor__body :deep(pre) {
  overflow-x: auto;
  padding: 12px 14px;
  border-radius: var(--radius-m);
  background: var(--color-doc-fill);
  font-size: var(--doc-code-size);
  line-height: 1.6;
  white-space: pre;
  overflow-wrap: normal;
}

.chapter-editor__body :deep(code) {
  font-family: var(--font-mono);
}

.chapter-editor__body :deep(:not(pre) > code) {
  font-size: 0.9em;
}

.chapter-editor__body :deep(:not(pre) > code) {
  padding: 0.1em 0.3em;
  border-radius: 3px;
  background: var(--color-doc-fill);
}

.chapter-editor__body :deep(a[data-href]) {
  color: var(--color-accent-text);
  text-decoration: underline;
  text-decoration-color: var(--color-accent-fill-strong);
  text-underline-offset: 0.18em;
}

.chapter-editor__body :deep(hr) {
  margin: 1.2em 0;
  border: none;
  border-top: 1px solid var(--color-doc-rule);
}

.chapter-editor__body :deep(table) {
  width: 100%;
  margin: 1em 0;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--doc-table-size);
}

.chapter-editor__body :deep(th),
.chapter-editor__body :deep(td) {
  position: relative;
  padding: 6px 10px;
  border: 1px solid var(--color-doc-rule);
  vertical-align: top;
}

.chapter-editor__body :deep(th) {
  background: var(--color-doc-header-fill);
  font-weight: 600;
  text-align: left;
}

.chapter-editor__body :deep(.selectedCell::after) {
  position: absolute;
  inset: 0;
  content: '';
  background: var(--color-accent-fill);
  pointer-events: none;
}

/*
 * 独占一段的图片（figure 节点，块级的 .editor-figure）：布局来自图片自己的设置或主题默认（image_layout.ts 的装饰）。
 * 尺寸规则与 Word / PDF 导出相同（export::images::display_size_pt）：原始尺寸不超过正文宽度；
 * 其他尺寸是正文宽度的固定比例；任何尺寸下高度不超过 560px（420 磅），超出时保持比例缩小。
 */
.chapter-editor__body :deep(.is-figure) {
  margin: var(--doc-image-spacing) 0;
  text-align: center;
}

.chapter-editor__body :deep(.is-figure[data-image-align='left']) {
  text-align: left;
}

.chapter-editor__body :deep(.is-figure[data-image-align='right']) {
  text-align: right;
}

.chapter-editor__body :deep(.editor-image img) {
  max-width: 100%;
  max-height: 560px;
  vertical-align: bottom;
  object-fit: contain;
}

.chapter-editor__body :deep(.is-figure[data-image-size='small'] img) {
  width: var(--doc-image-small);
}

.chapter-editor__body :deep(.is-figure[data-image-size='medium'] img) {
  width: var(--doc-image-medium);
}

.chapter-editor__body :deep(.is-figure[data-image-size='large'] img) {
  width: var(--doc-image-large);
}

.chapter-editor__body :deep(.is-figure[data-image-size='full'] img) {
  width: var(--doc-image-full);
}

.chapter-editor__body :deep(.is-figure[data-image-align='left'] img) {
  object-position: left;
}

.chapter-editor__body :deep(.is-figure[data-image-align='right'] img) {
  object-position: right;
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

.chapter-editor__body :deep(.editor-image__missing) {
  display: inline-block;
  padding: 8px 12px;
  border: 1px dashed var(--color-danger);
  border-radius: var(--radius-s);
  color: var(--color-danger-text);
  font-size: 14px;
  line-height: 1.6;
}
</style>
