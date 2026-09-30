<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Directive } from 'vue'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { DEFAULT_EDITOR_THEME, editorHeadingVars, editorThemeCssVars } from '../editor/editor_theme.ts'
import { topBlock, type BlockPosition } from '../editor/block_position.ts'
import type { ImageResolver } from '../editor/image_view.ts'
import { renderChapterBody } from './chapter_body.ts'
import '../editor/document_body.css'

/** 全文中的阅读位置：章节 + 章节中的块。 */
export interface ReadingPosition extends BlockPosition {
  readonly chapterId: ChapterId
}

/**
 * 全文阅读：按阅读顺序连续显示所有章节的标题、编号与正文，用于快速滚动浏览整篇文档（docs/decisions.md 第 8 节）。
 *
 * - 这是编辑环境的只读展示，不是导出效果预览：正文与编辑器使用同一套解析与样式（document_body.css）、
 *   同样的版心，没有分页，不承诺与 Word / PDF 的页面一致。
 * - 与章节树双向联动：滚动时视口顶端所在的章节成为当前章节（select）；
 *   当前章节从别处改变（章节树中点选）时滚动到该章节开头。
 * - initialPosition 与 position() 按块对齐编辑器中的位置，进入与离开时眼前的文字停在原处。
 * - 滚动区可以获得焦点：方向键、空格、Page Up / Down 直接滚动；Esc 或 Enter 结束阅读（exit），
 *   回到当前位置继续编辑。
 * - 只在正文变化的章节重新生成 DOM（阅读时通常不会变化，章节树中改名、移动时只更新标题与顺序）。
 */
const props = defineProps<{
  tree: ChapterTree
  contents: ReadonlyMap<ChapterId, string>
  activeChapterId: ChapterId | null
  resolveImage?: ImageResolver
  /** 打开时显示的位置；不提供时从当前章节开头开始。 */
  initialPosition?: ReadingPosition | null
}>()

const emit = defineEmits<{
  select: [chapterId: ChapterId]
  exit: [position: ReadingPosition | null]
}>()

interface Entry {
  readonly id: ChapterId
  readonly title: string
  readonly number: string
  readonly headingStyle: Record<string, string>
}

const numbers = computed(() => computeChapterNumbers(props.tree))

/** 按阅读顺序展开的章节（前序遍历，与导出相同）。 */
const chapters = computed<Entry[]>(() => {
  const entries: Entry[] = []
  const visit = (tree: ChapterTree): void => {
    for (const node of tree) {
      const number = numbers.value.get(node.id) ?? []
      entries.push({
        id: node.id,
        title: node.title,
        number: number.join('.'),
        headingStyle: editorHeadingVars(number.length),
      })
      visit(node.children)
    }
  }
  visit(props.tree)
  return entries
})

const THEME_VARS = editorThemeCssVars(DEFAULT_EDITOR_THEME)

const resolve: ImageResolver = (reference) => props.resolveImage?.(reference) ?? null

/** 正文 DOM：只在该章节的正文变化时重新生成。 */
const vChapterBody: Directive<HTMLElement, string> = {
  mounted(element, { value }) {
    element.replaceChildren(renderChapterBody(value, resolve))
  },
  updated(element, { value, oldValue }) {
    if (value !== oldValue) element.replaceChildren(renderChapterBody(value, resolve))
  },
}

const scroller = ref<HTMLElement | null>(null)

function sections(): HTMLElement[] {
  return [...(scroller.value?.querySelectorAll<HTMLElement>('.document-reader__chapter') ?? [])]
}

function sectionOf(chapterId: ChapterId): HTMLElement | undefined {
  return sections().find((section) => section.dataset.chapterId === chapterId)
}

/** 视口顶端所在的位置；没有章节时为 null。 */
function position(): ReadingPosition | null {
  if (!scroller.value) return null
  const top = scroller.value.getBoundingClientRect().top
  const all = sections()
  // 章节之间的留白属于后一章（它的上内边距）；多 1px 容忍滚动位置取整。
  const found = topBlock(all, top + 1)
  if (found === null) return null
  const section = all[found.block]
  const chapterId = section.dataset.chapterId as ChapterId
  // 章节开头（标题与它上方的留白）的位置以章节区块的顶端计，对应编辑器中标题区域的顶端。
  const start = { chapterId, block: -1, offset: section.getBoundingClientRect().top - top }
  const heading = section.querySelector('.document-reader__heading')!
  if (heading.getBoundingClientRect().bottom > top) return start
  const body = section.querySelector('.document-reader__body')!
  const block = topBlock(body.children, top)
  return block === null ? start : { chapterId, ...block }
}

/** 把位置滚到视口中相同的高度。 */
function reveal(target: ReadingPosition): void {
  const section = sectionOf(target.chapterId)
  if (!scroller.value || !section) return
  const blocks = section.querySelector('.document-reader__body')!.children
  const element = target.block < 0 ? section : (blocks[Math.min(target.block, blocks.length - 1)] ?? section)
  const top = scroller.value.getBoundingClientRect().top
  scroller.value.scrollTop += element.getBoundingClientRect().top - top - target.offset
}

/** 由滚动得出、刚刚发出的当前章节：它回传为 activeChapterId 时不再滚动。 */
let spied: ChapterId | null = props.activeChapterId

watch(
  () => props.activeChapterId,
  (id) => {
    if (id === null || id === spied) return
    spied = id
    reveal({ chapterId: id, block: -1, offset: 0 })
  },
)

let frame: number | null = null

function onScroll(): void {
  if (frame !== null) return
  frame = requestAnimationFrame(() => {
    frame = null
    const current = position()
    if (current === null || current.chapterId === props.activeChapterId) return
    spied = current.chapterId
    emit('select', current.chapterId)
  })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.target !== scroller.value) return
  if (event.key !== 'Escape' && event.key !== 'Enter') return
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
  event.preventDefault()
  emit('exit', position())
}

function focus(): void {
  scroller.value?.focus({ preventScroll: true })
}

onMounted(() => {
  const start = props.initialPosition ?? (props.activeChapterId ? { chapterId: props.activeChapterId, block: -1, offset: 0 } : null)
  if (start) reveal(start)
  focus()
})

onBeforeUnmount(() => {
  if (frame !== null) cancelAnimationFrame(frame)
})

defineExpose({ position, focus })
</script>

<template>
  <div
    ref="scroller"
    class="document-reader"
    :style="THEME_VARS"
    tabindex="0"
    role="document"
    aria-label="全文阅读"
    @scroll="onScroll"
    @keydown="onKeydown"
  >
    <section
      v-for="chapter in chapters"
      :key="chapter.id"
      class="document-reader__chapter"
      :data-chapter-id="chapter.id"
      :style="chapter.headingStyle"
    >
      <h1 class="document-reader__heading document-heading">
        <span class="document-heading__number">{{ chapter.number }}</span>
        <span :class="{ 'document-heading__title--untitled': !chapter.title }">{{ chapter.title || '未命名章节' }}</span>
      </h1>
      <div v-chapter-body="contents.get(chapter.id) ?? ''" class="document-reader__body document-body"></div>
    </section>
  </div>
</template>

<style scoped>
.document-reader {
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  scrollbar-gutter: stable;
  background: var(--color-bg);
  outline: none;
  -webkit-user-select: text;
  user-select: text;
}

/*
 * 每章的开头与编辑器中这一章的开头相同：同样的版心、标题上下留白与正文起始间距。
 * 章节之间的留白是后一章的上内边距，属于后一章（滚动定位与当前章节的判断以章节区块为准）。
 */
.document-reader__chapter {
  max-width: var(--doc-column);
  box-sizing: border-box;
  margin: 0 auto;
  padding: calc(var(--space-10) + var(--space-6)) var(--doc-gutter) 0;
}

/* 最后一章至少占满视口：再短也能滚到顶端成为当前章节，读到文末时正文下方留有空白。 */
.document-reader__chapter:last-child {
  min-height: 100%;
}

.document-reader__heading {
  padding-bottom: var(--space-4);
}

/* 正文与编辑器（.chapter-editor__content）的上边距相同，块的位置因此一一对应。 */
.document-reader__body {
  padding-top: var(--space-7);
}

/* 图注在编辑器中是文本框，这里是文字：内边距与文本框相同，高度与位置一致。 */
.document-reader__body :deep(.editor-figure__caption) {
  padding: var(--space-1) var(--space-3);
  white-space: pre-wrap;
}
</style>
