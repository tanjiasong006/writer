<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { THEMES, type DocumentTheme } from '../../domain/document_style/document_style.ts'
import { themeCssVars } from '../document_style/theme_css.ts'

/**
 * 全文预览：显示 Rust render::html 生成的 HTML（所有文本已转义，不含脚本与链接跳转），
 * 因此可以安全地使用 v-html。
 * - 图片以 data-writer-src 给出本地路径，这里经 toDisplayUrl 转成可显示的地址。
 * - activeChapterId 变化时滚动到该章节；点击某一章节发出 select。
 * - HTML 只有语义结构；排版来自文档主题（与编辑器共用 theme_css 的 CSS 变量），
 *   独立成段的图片以 data-size / data-align 标明布局。
 */
const props = defineProps<{
  html: string
  activeChapterId?: ChapterId | null
  toDisplayUrl: (filePath: string) => string
  /** 文档主题（已解析）；不提供时使用默认主题。 */
  theme?: DocumentTheme
}>()

const themeStyle = computed(() => themeCssVars(props.theme ?? THEMES.book))

const emit = defineEmits<{ select: [chapterId: ChapterId] }>()

const root = ref<HTMLElement | null>(null)

function resolveImages(): void {
  for (const image of root.value?.querySelectorAll<HTMLImageElement>('img[data-writer-src]') ?? []) {
    image.src = props.toDisplayUrl(image.dataset.writerSrc ?? '')
  }
}

function scrollToActive(behavior: ScrollBehavior): void {
  const id = props.activeChapterId
  if (!id || !root.value) return
  const section = [...root.value.querySelectorAll<HTMLElement>('section[data-chapter-id]')].find(
    (candidate) => candidate.dataset.chapterId === id,
  )
  section?.scrollIntoView?.({ block: 'start', behavior })
}

watch(
  () => props.html,
  async (_html, previous) => {
    await nextTick()
    resolveImages()
    // 首次显示时定位到当前章节；之后内容更新不打断用户的阅读位置。
    if (previous === undefined || previous === '') scrollToActive('auto')
  },
  { immediate: true },
)

/** 在预览中点击选中的章节：它已经在眼前，选中变化时不再滚动到章节开头。 */
let selectedByClick: ChapterId | null = null

watch(
  () => props.activeChapterId,
  (id) => {
    const fromClick = id === selectedByClick
    selectedByClick = null
    if (!fromClick) scrollToActive('smooth')
  },
)

function onClick(event: MouseEvent): void {
  const section = (event.target as HTMLElement | null)?.closest<HTMLElement>('section[data-chapter-id]')
  const id = section?.dataset.chapterId
  if (!id || id === props.activeChapterId) return
  selectedByClick = id
  emit('select', id)
}
</script>

<template>
  <article ref="root" class="document-preview" :style="themeStyle" @click="onClick" v-html="html"></article>
</template>

<style scoped>
/*
 * 版心宽度与编辑器相同；字体、字号、行距、段距、标题、引用、代码、表格、图注与图片布局
 * 来自文档主题的 CSS 变量（ui/document_style/theme_css.ts）。
 * 标题标签与层级：h2 = 第 1 级，h3 = 第 2 级，h4 及更深 = 第 3 级（与 Rust render::html 的输出一致）。
 */
.document-preview {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 32px 40vh;
  font-family: var(--doc-body-font);
  font-size: var(--doc-body-size);
  line-height: var(--doc-line-height);
  color: #111827;
  /* 应用界面关闭了字体合成（App.vue）；正文要像 Word / PDF 一样为没有斜体、粗体字形的中文字体合成斜体与粗体。 */
  font-synthesis: weight style;
  /* 过长的 URL、路径与导出一致地在任意字符处折行，不撑出横向滚动。 */
  overflow-wrap: anywhere;
}

.document-preview :deep(.doc-title) {
  margin: 0 0 1.4em;
  font-family: var(--doc-title-font);
  font-size: var(--doc-title-size);
  line-height: 1.4;
  text-align: center;
}

.document-preview :deep(.chapter) {
  cursor: default;
}

.document-preview :deep(h2),
.document-preview :deep(h3),
.document-preview :deep(h4),
.document-preview :deep(h5),
.document-preview :deep(h6) {
  line-height: 1.4;
}

.document-preview :deep(h2) {
  margin: var(--doc-h1-before) 0 var(--doc-h1-after);
  font-family: var(--doc-h1-font);
  font-size: var(--doc-h1-size);
}

.document-preview :deep(h3) {
  margin: var(--doc-h2-before) 0 var(--doc-h2-after);
  font-family: var(--doc-h2-font);
  font-size: var(--doc-h2-size);
}

.document-preview :deep(h4),
.document-preview :deep(h5),
.document-preview :deep(h6) {
  margin: var(--doc-h3-before) 0 var(--doc-h3-after);
  font-family: var(--doc-h3-font);
  font-size: var(--doc-h3-size);
}

.document-preview :deep(.chapter-number) {
  margin-right: 10px;
  color: #6b7280;
  font-variant-numeric: tabular-nums;
}

.document-preview :deep(p) {
  margin: var(--doc-paragraph-spacing) 0;
}

.document-preview :deep(blockquote) {
  margin: 1em 0;
  padding: 0 1em;
  border-left: 3px solid #d1d5db;
  color: #4b5563;
  font-family: var(--doc-quote-font);
  font-size: var(--doc-quote-size);
}

.document-preview :deep(pre) {
  overflow-x: auto;
  padding: 12px 14px;
  border-radius: 6px;
  background: #f3f4f6;
  font-size: var(--doc-code-size);
  line-height: 1.6;
}

.document-preview :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.document-preview :deep(:not(pre) > code) {
  font-size: 0.9em;
}

.document-preview :deep(table) {
  width: 100%;
  margin: 1em 0;
  border-collapse: collapse;
  font-size: var(--doc-table-size);
}

.document-preview :deep(th),
.document-preview :deep(td) {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
}

.document-preview :deep(th) {
  background: #f9fafb;
}

/* 图片尺寸规则与编辑器、Word / PDF 导出相同（见 ChapterEditor 与 export::images::display_size_pt）。 */
.document-preview :deep(figure) {
  margin: var(--doc-image-spacing) 0;
  text-align: center;
}

.document-preview :deep(figure[data-align='left']) {
  text-align: left;
}

.document-preview :deep(figure[data-align='right']) {
  text-align: right;
}

.document-preview :deep(img) {
  max-width: 100%;
  max-height: 560px;
  object-fit: contain;
}

.document-preview :deep(figure[data-size='small'] img) {
  width: var(--doc-image-small);
}

.document-preview :deep(figure[data-size='medium'] img) {
  width: var(--doc-image-medium);
}

.document-preview :deep(figure[data-size='large'] img) {
  width: var(--doc-image-large);
}

.document-preview :deep(figure[data-size='full'] img) {
  width: var(--doc-image-full);
}

.document-preview :deep(figure[data-align='left'] img) {
  object-position: left;
}

.document-preview :deep(figure[data-align='right'] img) {
  object-position: right;
}

.document-preview :deep(figcaption) {
  margin-top: 4px;
  color: #6b7280;
  font-family: var(--doc-caption-font);
  font-size: var(--doc-caption-size);
}

.document-preview :deep(.missing-image) {
  display: inline-block;
  padding: 8px 12px;
  border: 1px dashed #f87171;
  border-radius: 4px;
  color: #b91c1c;
  font-size: 14px;
}

.document-preview :deep(.link) {
  color: #2563eb;
}
</style>
