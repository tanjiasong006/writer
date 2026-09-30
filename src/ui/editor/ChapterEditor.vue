<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
import { editSelectedCaption, figureNodeView, imageNodeView, type ImageResolver } from './image_view.ts'
import { DEFAULT_EDITOR_THEME, editorHeadingVars, editorThemeCssVars } from './editor_theme.ts'

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
}>()

const emit = defineEmits<{
  change: [chapterId: ChapterId, text: string]
  /** 用户点击了"插入图片"；由上层选择并导入图片后调用 insertImage。 */
  'request-image': [chapterId: ChapterId]
  /** 编辑命令的可用 / 勾选状态（由上层的工具栏与菜单栏显示）。 */
  tools: [state: CommandState]
}>()

/** 滚动容器（每个章节记住自己的滚动位置）。 */
const scroller = ref<HTMLElement | null>(null)
const mountPoint = ref<HTMLElement | null>(null)
const tools = shallowRef<CommandState | null>(null)

const THEME_VARS = editorThemeCssVars(DEFAULT_EDITOR_THEME)
/** 章节层级：决定章节标题与正文标题使用哪一级标题样式。 */
const depth = computed(() => Math.max(1, props.number.split('.').filter(Boolean).length))
const themeStyle = computed(() => ({ ...THEME_VARS, ...editorHeadingVars(depth.value) }))

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
}

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
    nodeViews: { image: imageNodeView(resolveImage), figure: figureNodeView(resolveImage) },
    attributes: { class: 'chapter-editor__content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '正文' },
  })
  showState(state)
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
    if (onFigure) view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, hit.inside)))
    else if (!inSelection(selection, hit.pos) || selection instanceof NodeSelection) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(hit.pos))))
    }
  }
  await showContextMenu({ x: event.clientX, y: event.clientY }, false)
}

/** Shift+F10 / 菜单键：在光标处打开右键菜单（与章节树相同）。⌘/ 经菜单栏调用 openMenuAtCaret。 */
function onKeydown(event: KeyboardEvent): void {
  if (isCaption(event.target)) return
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
  const { selection } = view.state
  const onFigure = selection instanceof NodeSelection && selection.node.type === nodes.figure
  const entries = editorContextMenu(commandState(view.state), onFigure ? (selection.node.attrs.alt as string) : null)
  const chosen = await menu.open(entries, anchor, keyboard)
  if (chosen !== null) runMenuItem(chosen)
}

function runMenuItem(id: string): void {
  const [kind, value] = id.split(':')
  if (kind === 'command') runCommand(value as EditorCommand)
  else if (id === 'figure:caption' && view) editSelectedCaption(view)
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

defineExpose({
  insertImage: insertImageAt,
  runCommand,
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
 * 它按在文档中的层级使用对应级别的标题样式，与正文共用版心。
 */
.chapter-editor__heading {
  max-width: var(--doc-column);
  box-sizing: border-box;
  margin: 0 auto;
  padding: calc(var(--space-10) + var(--space-6)) var(--doc-gutter) var(--space-4);
  font-family: var(--heading-font);
  font-size: var(--heading-size);
  font-weight: var(--weight-semibold);
  line-height: 1.4;
  text-wrap: balance;
  color: var(--color-doc-text);
  overflow-wrap: anywhere;
  /* 标题只能在章节树中修改，这里不可选中编辑，避免被误认为正文的一部分。 */
  -webkit-user-select: none;
  user-select: none;
}

.chapter-editor__number {
  margin-right: 0.6em;
  color: var(--color-text-tertiary);
  font-weight: normal;
  font-variant-numeric: tabular-nums;
}

.chapter-editor__title--untitled {
  color: var(--color-text-tertiary);
}

/*
 * 正文展示：字体、字号、行距、段距、标题、引用、代码、表格、图注与图片间距
 * 都来自编辑环境展示参数的 CSS 变量（editor_theme.ts）。
 * ProseMirror 生成的 DOM 不带 scoped 属性，因此用 :deep。
 */
.chapter-editor__body :deep(.chapter-editor__content) {
  max-width: var(--doc-column);
  box-sizing: border-box;
  margin: 0 auto;
  /* 下方留出大段空白：写到最后一段时仍可以把它滚到视线高度，而不是贴着窗口底边。 */
  padding: var(--space-7) var(--doc-gutter) 40vh;
  font-family: var(--doc-body-font);
  font-size: var(--doc-body-size);
  line-height: var(--doc-line-height);
  color: var(--color-doc-text);
  /* 应用界面关闭了字体合成（App.vue）；正文要像 Word / PDF 一样为没有斜体、粗体字形的中文字体合成斜体与粗体。 */
  font-synthesis: weight style;
  /*
   * 中文排版：中西文之间的间距、相邻标点挤压、严格避头尾、行尾标点悬挂。只影响显示，不往正文里插入空格；
   * 不支持的 WebView 忽略这些属性。
   */
  text-autospace: normal;
  text-spacing-trim: normal;
  line-break: strict;
  hanging-punctuation: allow-end;
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

.chapter-editor__body :deep(blockquote) {
  margin: 1.2em 0;
  padding: 0 0 0 1.2em;
  border-left: 2px solid var(--color-doc-rule);
  font-family: var(--doc-quote-font);
  font-size: var(--doc-quote-size);
}

.chapter-editor__body :deep(ul),
.chapter-editor__body :deep(ol) {
  margin: 0.6em 0;
  padding-left: 1.6em;
}

.chapter-editor__body :deep(ol) {
  font-variant-numeric: tabular-nums;
}

.chapter-editor__body :deep(li::marker) {
  color: var(--color-doc-muted);
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

/* 任务方框自绘（☐ / ☑ 字符的样子取决于字体），在第一行中垂直居中。 */
.chapter-editor__body :deep(li[data-task]::before) {
  position: absolute;
  top: calc((var(--doc-line-height) * 1em - 0.82em) / 2);
  left: -1.45em;
  box-sizing: border-box;
  width: 0.82em;
  height: 0.82em;
  border: 1.5px solid var(--color-doc-rule);
  border-radius: 3px;
  content: '';
}

.chapter-editor__body :deep(li[data-task='done']) {
  color: var(--color-doc-muted);
}

.chapter-editor__body :deep(li[data-task='done']::before) {
  border-color: var(--color-doc-muted);
  background: var(--color-doc-muted) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.6 6.3l2.2 2.2 4.6-4.9' fill='none' stroke='%23fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
    center / 100% no-repeat;
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
  border-top: 1.5px solid var(--color-doc-table-rule);
  border-bottom: 1.5px solid var(--color-doc-table-rule);
  font-size: var(--doc-table-size);
}

/*
 * 三线表：顶线、底线与表头下的线，不画单元格边界。
 * 指针移入或光标在表格中（is-active，plugins.ts）时用内阴影淡淡显示单元格边界，编辑时看得清格子；
 * 不用透明边框，它们在折叠边框的交点处留下断痕，也不改变布局。表格的第一行总是表头。
 */
.chapter-editor__body :deep(th),
.chapter-editor__body :deep(td) {
  position: relative;
  padding: 7px 12px;
  vertical-align: top;
  transition: box-shadow var(--duration-base) var(--ease-out);
}

.chapter-editor__body :deep(th) {
  border-bottom: 1px solid var(--color-doc-table-rule);
  /* 表头用标题的无衬线字体：它有真正的粗体字形，宋体类中文在表头中合成的粗体几乎看不出来。 */
  font-family: var(--doc-h3-font);
  font-weight: var(--weight-semibold);
  text-align: left;
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
 * 图片按统一规则适应编辑区域（没有单张图片的尺寸 / 对齐设置）：保持比例、不放大、不超过所在容器的宽度，
 * 高度不超过统一的展示上限（行内图片同样适用，超长图片不会无限撑高正文区）。
 * 独占一段的图片（figure 节点，块级的 .editor-figure）居中。
 */
.chapter-editor__body :deep(.editor-figure) {
  margin: var(--doc-image-spacing) 0;
  text-align: center;
}

/*
 * 图注（image_view.ts）：紧贴图片、居中、小一号。它是一个随内容增高的文本框：隐藏的同内容 ::after
 * 与文本框放在同一网格格中撑开高度。没有图注时只在选中图片或编辑时显示“添加图注”。
 */
.chapter-editor__body :deep(.editor-figure__caption) {
  display: grid;
  max-width: 36em;
  margin: var(--space-3) auto 0;
  font-family: var(--doc-caption-font);
  font-size: var(--doc-caption-size);
  line-height: 1.6;
  color: var(--color-doc-muted);
}

.chapter-editor__body :deep(.editor-figure:not(.has-caption, .ProseMirror-selectednode, .is-editing) .editor-figure__caption) {
  display: none;
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

.chapter-editor__body :deep(.editor-image img) {
  max-width: 100%;
  max-height: 560px;
  vertical-align: bottom;
  object-fit: contain;
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
