<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'

/**
 * 全文预览：显示 Rust render::html 生成的 HTML（所有文本已转义，不含脚本与链接跳转），
 * 因此可以安全地使用 v-html。
 * - 图片以 data-writer-src 给出本地路径，这里经 toDisplayUrl 转成可显示的地址。
 * - activeChapterId 变化时滚动到该章节；点击某一章节发出 select。
 */
const props = defineProps<{
  html: string
  activeChapterId?: ChapterId | null
  toDisplayUrl: (filePath: string) => string
}>()

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
  <article ref="root" class="document-preview" @click="onClick" v-html="html"></article>
</template>

<style scoped>
.document-preview {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 32px 40vh;
  font-size: 16px;
  line-height: 1.8;
  color: #111827;
  /* 过长的 URL、路径与导出一致地在任意字符处折行，不撑出横向滚动。 */
  overflow-wrap: anywhere;
}

.document-preview :deep(.doc-title) {
  margin: 0 0 32px;
  font-size: 28px;
  text-align: center;
}

.document-preview :deep(.chapter) {
  cursor: default;
}

.document-preview :deep(.chapter-heading) {
  margin: 1.6em 0 0.6em;
  line-height: 1.4;
}

.document-preview :deep(h2) {
  font-size: 22px;
}

.document-preview :deep(h3) {
  font-size: 19px;
}

.document-preview :deep(h4),
.document-preview :deep(h5),
.document-preview :deep(h6) {
  font-size: 17px;
}

.document-preview :deep(.chapter-number) {
  margin-right: 10px;
  color: #6b7280;
  font-variant-numeric: tabular-nums;
}

.document-preview :deep(p) {
  margin: 0.6em 0;
}

.document-preview :deep(blockquote) {
  margin: 1em 0;
  padding: 0 1em;
  border-left: 3px solid #d1d5db;
  color: #4b5563;
}

.document-preview :deep(pre) {
  overflow-x: auto;
  padding: 12px 14px;
  border-radius: 6px;
  background: #f3f4f6;
  font-size: 14px;
  line-height: 1.6;
}

.document-preview :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}

.document-preview :deep(table) {
  width: 100%;
  margin: 1em 0;
  border-collapse: collapse;
  font-size: 15px;
}

.document-preview :deep(th),
.document-preview :deep(td) {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
}

.document-preview :deep(th) {
  background: #f9fafb;
}

.document-preview :deep(figure) {
  margin: 1.2em 0;
  text-align: center;
}

/* 与 Word / PDF 导出相同的尺寸规则：不超过正文宽度，高度不超过 420 磅（560px），保持比例。 */
.document-preview :deep(img) {
  max-width: 100%;
  max-height: 560px;
}

.document-preview :deep(figcaption) {
  margin-top: 4px;
  color: #6b7280;
  font-size: 14px;
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
