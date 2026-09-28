<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EditorView } from 'prosemirror-view'
import type { EditorState, Transaction } from 'prosemirror-state'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import EditorToolbar from './EditorToolbar.vue'
import { ChapterDocuments } from './chapter_documents.ts'
import { insertImage, toolbarCommands, toolbarState, type ToolbarCommand, type ToolbarState } from './commands.ts'
import { imageNodeView, type ImageResolver } from './image_view.ts'
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
  type ImageLayouts,
  type ImageOverride,
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
}>()

/** 滚动容器（每个章节记住自己的滚动位置）。 */
const scroller = ref<HTMLElement | null>(null)
const mountPoint = ref<HTMLElement | null>(null)
const toolbar = shallowRef<ToolbarState | null>(null)
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
  toolbar.value = toolbarState(state)
  figure.value = selectedFigure(state)
}

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
  view = new EditorView(mountPoint.value!, {
    state,
    dispatchTransaction,
    nodeViews: { image: imageNodeView(props.resolveImage ?? (() => null)) },
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

function runCommand(command: ToolbarCommand): void {
  if (!view) return
  if (command === 'image') {
    emit('request-image', currentId)
    return
  }
  toolbarCommands[command](view.state, view.dispatch)
  view.focus()
}

/**
 * 在光标处插入图片。chapterId 是发起请求时的章节；
 * 若期间已切换到其他章节（或光标处不能插入）则不插入并返回 false，由调用方另行处理，避免插错位置。
 */
function insertImageAt(chapterId: ChapterId, reference: string, alt: string): boolean {
  if (!view || chapterId !== currentId) return false
  if (!insertImage(reference, alt)(view.state, view.dispatch)) return false
  view.focus()
  return true
}

defineExpose({
  insertImage: insertImageAt,
  /** 当前的 EditorView（测试与调试用）。 */
  getView: (): EditorView | null => view,
  focus: () => view?.focus(),
})
</script>

<template>
  <div class="chapter-editor" :style="themeStyle">
    <h2 class="chapter-editor__heading">
      <span class="chapter-editor__number">{{ number }}</span>
      <span class="chapter-editor__title">{{ title || '未命名章节' }}</span>
    </h2>
    <EditorToolbar :state="toolbar" @command="runCommand">
      <template v-if="figure" #context>
        <ImageLayoutControls :layout="figure.layout" @change="changeFigureLayout" />
      </template>
    </EditorToolbar>
    <div ref="scroller" class="chapter-editor__scroller">
      <div ref="mountPoint" class="chapter-editor__body"></div>
    </div>
  </div>
</template>

<style scoped>
.chapter-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chapter-editor__heading {
  flex: none;
  width: 100%;
  max-width: 760px;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 24px 32px 8px;
  /* 章节标题按它在文档中的层级使用主题的标题样式（与预览 / 导出一致）。 */
  font-family: var(--heading-font);
  font-size: var(--heading-size);
  line-height: 1.4;
}

.chapter-editor__number {
  margin-right: 10px;
  color: #6b7280;
  font-variant-numeric: tabular-nums;
}

.chapter-editor__scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}


/*
 * 正文排版与全文预览（DocumentPreview）一致：宽度相同，字体、字号、行距、段距、标题、引用、代码、
 * 表格、图注与图片布局都来自文档主题的 CSS 变量（ui/document_style/theme_css.ts）。
 * ProseMirror 生成的 DOM 不带 scoped 属性，因此用 :deep。
 */
.chapter-editor__body :deep(.chapter-editor__content) {
  max-width: 760px;
  min-height: 100%;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 8px 32px 40vh;
  font-family: var(--doc-body-font);
  font-size: var(--doc-body-size);
  line-height: var(--doc-line-height);
  color: #111827;
  caret-color: #111827;
  outline: none;
  overflow-wrap: anywhere;
}

.chapter-editor__body :deep(p) {
  margin: var(--doc-paragraph-spacing) 0;
}

.chapter-editor__body :deep(.is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: #9ca3af;
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
  border-left: 3px solid #d1d5db;
  color: #4b5563;
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
  color: #6b7280;
}

.chapter-editor__body :deep(li[data-task='done']::before) {
  content: '☑';
}

.chapter-editor__body :deep(pre) {
  overflow-x: auto;
  padding: 12px 14px;
  border-radius: 6px;
  background: #f3f4f6;
  font-size: var(--doc-code-size);
  line-height: 1.6;
  white-space: pre;
  overflow-wrap: normal;
}

.chapter-editor__body :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.chapter-editor__body :deep(:not(pre) > code) {
  font-size: 0.9em;
}

.chapter-editor__body :deep(:not(pre) > code) {
  padding: 0.1em 0.3em;
  border-radius: 3px;
  background: #f3f4f6;
}

.chapter-editor__body :deep(a[data-href]) {
  color: #2563eb;
  text-decoration: underline;
}

.chapter-editor__body :deep(hr) {
  margin: 1.2em 0;
  border: none;
  border-top: 1px solid #d1d5db;
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
  border: 1px solid #d1d5db;
  vertical-align: top;
}

.chapter-editor__body :deep(th) {
  background: #f9fafb;
  font-weight: 600;
  text-align: left;
}

.chapter-editor__body :deep(.selectedCell::after) {
  position: absolute;
  inset: 0;
  content: '';
  background: rgba(37, 99, 235, 0.12);
  pointer-events: none;
}

/*
 * 独占一段的图片（figure）：布局来自图片自己的设置或主题默认（image_layout.ts 的装饰）。
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

.chapter-editor__body :deep(.is-figure[data-image-size='small'] .editor-image img) {
  width: var(--doc-image-small);
}

.chapter-editor__body :deep(.is-figure[data-image-size='medium'] .editor-image img) {
  width: var(--doc-image-medium);
}

.chapter-editor__body :deep(.is-figure[data-image-size='large'] .editor-image img) {
  width: var(--doc-image-large);
}

.chapter-editor__body :deep(.is-figure[data-image-size='full'] .editor-image img) {
  width: var(--doc-image-full);
}

.chapter-editor__body :deep(.is-figure[data-image-align='left'] .editor-image img) {
  object-position: left;
}

.chapter-editor__body :deep(.is-figure[data-image-align='right'] .editor-image img) {
  object-position: right;
}

.chapter-editor__body :deep(.editor-image.ProseMirror-selectednode img),
.chapter-editor__body :deep(.editor-image.ProseMirror-selectednode .editor-image__missing) {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}

.chapter-editor__body :deep(.editor-image__missing) {
  display: inline-block;
  padding: 8px 12px;
  border: 1px dashed #f87171;
  border-radius: 4px;
  color: #b91c1c;
  font-size: 14px;
  line-height: 1.6;
}
</style>
