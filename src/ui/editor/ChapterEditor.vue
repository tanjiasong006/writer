<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { createChapterState, readText } from './editor_state.ts'
import EditorToolbar, { type ToolbarCommand } from './EditorToolbar.vue'
import {
  insertCodeBlock,
  insertImage,
  insertTable,
  toggleBold,
  toggleBulletList,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
} from './markdown_commands.ts'
import type { StateCommand } from '@codemirror/state'

/**
 * 章节正文编辑器：CodeMirror 6 Markdown 源码编辑（docs/decisions.md 第 2 节）。
 *
 * - 每个章节一个 EditorState 缓存，切换章节后撤销历史仍在。
 * - 只有用户真正编辑时才发出 change；change 携带编辑发生时的章节 id，切换章节后不会写错章节。
 * - 章节标题与编号只显示在编辑器上方，不进入正文。
 */
const props = defineProps<{
  chapterId: ChapterId
  content: string
  /** 章节编号的显示文本，如 "2.1"。 */
  number: string
  title: string
}>()

const emit = defineEmits<{
  change: [chapterId: ChapterId, text: string]
  /** 用户点击了"插入图片"；由上层选择并导入图片后调用 insertImage。 */
  'request-image': [chapterId: ChapterId]
}>()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
const states = new Map<ChapterId, EditorState>()
let currentId = props.chapterId
/** 最近一次与编辑器同步的正文，用来区分"自己发出的修改"和外部修改。 */
let lastText = props.content
let applyingExternal = false

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.heading1, fontSize: '1.3em' },
  { tag: tags.heading2, fontSize: '1.15em' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: '#2563eb' },
  { tag: tags.url, color: '#6b7280' },
  { tag: tags.quote, color: '#4b5563' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#b45309' },
  { tag: tags.processingInstruction, color: '#9ca3af' },
  { tag: tags.meta, color: '#9ca3af' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.8' },
  '.cm-content': {
    maxWidth: '760px',
    margin: '0 auto',
    padding: '8px 32px 40vh',
    caretColor: '#111827',
  },
  '.cm-placeholder': { color: '#9ca3af' },
})

const extensions = [
  history(),
  drawSelection(),
  EditorView.lineWrapping,
  markdown(),
  syntaxHighlighting(highlight),
  keymap.of([
    { key: 'Mod-b', run: toggleBold },
    { key: 'Mod-i', run: toggleItalic },
    ...markdownKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    ...searchKeymap,
    indentWithTab,
  ]),
  placeholder('开始写作…'),
  theme,
  EditorView.updateListener.of((update) => {
    if (!update.docChanged || applyingExternal) return
    lastText = readText(update.state)
    emit('change', currentId, lastText)
  }),
]

/** 复用缓存状态（保留撤销历史），前提是它与当前正文一致。 */
function stateFor(chapterId: ChapterId, text: string): EditorState {
  const cached = states.get(chapterId)
  if (cached && readText(cached) === text) return cached
  return createChapterState(text, extensions)
}

onMounted(() => {
  view = new EditorView({ state: stateFor(props.chapterId, props.content), parent: host.value! })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(
  () => [props.chapterId, props.content] as const,
  ([chapterId, text]) => {
    if (!view) return
    if (chapterId !== currentId) {
      states.set(currentId, view.state)
      currentId = chapterId
      lastText = text
      view.setState(stateFor(chapterId, text))
      return
    }
    if (text === lastText) return
    // 外部修改了当前章节正文：整体替换，仍保留在撤销历史中。
    lastText = text
    applyingExternal = true
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    } finally {
      applyingExternal = false
    }
  },
)

const commands: Record<Exclude<ToolbarCommand, 'image'>, StateCommand> = {
  bold: toggleBold,
  italic: toggleItalic,
  'bullet-list': toggleBulletList,
  'ordered-list': toggleOrderedList,
  quote: toggleQuote,
  'code-block': insertCodeBlock,
  table: insertTable,
}

function runCommand(command: ToolbarCommand): void {
  if (!view) return
  if (command === 'image') {
    emit('request-image', currentId)
    return
  }
  commands[command](view)
  view.focus()
}

/**
 * 在光标处插入图片引用。chapterId 是发起请求时的章节；
 * 若期间已切换到其他章节则不插入并返回 false，由调用方另行处理，避免插错章节。
 */
function insertImageAt(chapterId: ChapterId, reference: string, alt: string): boolean {
  if (!view || chapterId !== currentId) return false
  insertImage(reference, alt)(view)
  view.focus()
  return true
}

defineExpose({
  insertImage: insertImageAt,
  /** 供工具栏等在当前编辑器上执行命令。 */
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
    <EditorToolbar @command="runCommand" />
    <div ref="host" class="chapter-editor__host"></div>
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

.chapter-editor__host {
  flex: 1;
  min-height: 0;
}
</style>
