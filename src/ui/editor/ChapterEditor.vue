<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EditorView } from 'prosemirror-view'
import type { Transaction } from 'prosemirror-state'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import EditorToolbar from './EditorToolbar.vue'
import { ChapterDocuments } from './chapter_documents.ts'
import { insertImage, toolbarCommands, toolbarState, type ToolbarCommand, type ToolbarState } from './commands.ts'
import { imageNodeView, type ImageResolver } from './image_view.ts'

/**
 * 章节正文编辑器：ProseMirror 结构化编辑，正文仍以 Markdown 保存（docs/decisions.md 第 2 节）。
 *
 * - 整个组件只有一个 EditorView；切换章节时换入该章节缓存的 EditorState（撤销历史、选区仍在），不重建视图。
 * - 只有文档真正改变时才发出 change；change 携带事务发生时的章节 id，切换章节后不会写错章节。
 * - 父组件把 change 回传为 content 时不做任何事；只有与编辑器不一致的 content（外部修改）才替换文档。
 * - 章节标题与编号只显示在编辑器上方，不进入正文。
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
}>()

/** 滚动容器（每个章节记住自己的滚动位置）。 */
const scroller = ref<HTMLElement | null>(null)
const mountPoint = ref<HTMLElement | null>(null)
const toolbar = shallowRef<ToolbarState | null>(null)

const documents = new ChapterDocuments()
/** 每个章节离开时的滚动位置；回到该章节时恢复，继续在原处写作。 */
const scrolls = new Map<ChapterId, number>()
let view: EditorView | null = null
let currentId = props.chapterId

function dispatchTransaction(tr: Transaction): void {
  if (!view) return
  const { state } = view.state.applyTransaction(tr)
  view.updateState(state)
  toolbar.value = toolbarState(state)
  const text = documents.update(currentId, state)
  if (text !== null) emit('change', currentId, text)
}

onMounted(() => {
  const state = documents.stateFor(currentId, props.content)
  view = new EditorView(mountPoint.value!, {
    state,
    dispatchTransaction,
    nodeViews: { image: imageNodeView(props.resolveImage ?? (() => null)) },
    attributes: { class: 'chapter-editor__content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '正文' },
  })
  toolbar.value = toolbarState(state)
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
      toolbar.value = toolbarState(next)
      scroller.value.scrollTop = reused ? (scrolls.get(chapterId) ?? 0) : 0
      return
    }
    if (documents.isCurrent(chapterId, text)) return
    // 外部修改了当前章节正文：整体替换，仍保留在撤销历史中；以新正文为基准，不回发 change。
    const doc = documents.rebase(chapterId, text)
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content))
  },
)

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
  <div class="chapter-editor">
    <h2 class="chapter-editor__heading">
      <span class="chapter-editor__number">{{ number }}</span>
      <span class="chapter-editor__title">{{ title || '未命名章节' }}</span>
    </h2>
    <EditorToolbar :state="toolbar" @command="runCommand" />
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
  font-size: 22px;
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
 * 正文排版与全文预览（DocumentPreview）一致：宽度、字号、行高、引用、代码、表格、图片。
 * ProseMirror 生成的 DOM 不带 scoped 属性，因此用 :deep。
 */
.chapter-editor__body :deep(.chapter-editor__content) {
  max-width: 760px;
  min-height: 100%;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 8px 32px 40vh;
  font-size: 16px;
  line-height: 1.8;
  color: #111827;
  caret-color: #111827;
  outline: none;
  overflow-wrap: anywhere;
}

.chapter-editor__body :deep(p) {
  margin: 0.6em 0;
}

.chapter-editor__body :deep(.is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: #9ca3af;
  pointer-events: none;
}

.chapter-editor__body :deep(h1),
.chapter-editor__body :deep(h2),
.chapter-editor__body :deep(h3),
.chapter-editor__body :deep(h4),
.chapter-editor__body :deep(h5),
.chapter-editor__body :deep(h6) {
  margin: 1.2em 0 0.4em;
  font-size: 1em;
  line-height: 1.4;
}

.chapter-editor__body :deep(h1) {
  font-size: 1.3em;
}

.chapter-editor__body :deep(h2) {
  font-size: 1.15em;
}

.chapter-editor__body :deep(blockquote) {
  margin: 1em 0;
  padding: 0 1em;
  border-left: 3px solid #d1d5db;
  color: #4b5563;
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
  font-size: 14px;
  line-height: 1.6;
  white-space: pre;
  overflow-wrap: normal;
}

.chapter-editor__body :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
  font-size: 15px;
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

/* 独占一段的图片与预览 / 导出一样居中显示。 */
.chapter-editor__body :deep(.is-figure) {
  margin: 1.2em 0;
  text-align: center;
}

/* 与 Word / PDF 导出相同的尺寸规则：不超过正文宽度，高度不超过 560px，保持比例。 */
.chapter-editor__body :deep(.editor-image img) {
  max-width: 100%;
  max-height: 560px;
  vertical-align: bottom;
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
