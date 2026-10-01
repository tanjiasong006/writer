<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { OutputResult } from '../../application/document_output.ts'
import { resolvePdfLayout, type PdfLayoutSettings } from '../../domain/pdf_layout/pdf_layout.ts'
import PdfPageViewer, { type PreviewPage } from './PdfPageViewer.vue'

/**
 * PDF 排版设置旁的样张：用与导出相同的排版生成文档开头的前几页（docs/pdf-layout.md 第 5 节）。
 *
 * - 设置变化立即重新排版；排版进行中又有变化时，只在完成后按最新设置再排一次，不排队。
 * - 重新排版期间保留上一次的页面，较慢时才淡出提示，避免快速切换时闪烁。
 * - 第一次结果出来之前显示一张按纸张比例的空白页；失败时在空白页上说明。
 * - 点击一页打开全尺寸查看（PdfPageViewer）；打开与关闭通过 viewer 事件告知排版设置，期间设置不处理按键。
 */
const props = defineProps<{
  settings: PdfLayoutSettings
  preview: (settings: PdfLayoutSettings) => Promise<OutputResult<readonly string[]>>
}>()

const emit = defineEmits<{ viewer: [open: boolean] }>()

const PAPER_MM = {
  a4: [210, 297],
  b5: [176, 250],
  a5: [148, 210],
  letter: [215.9, 279.4],
} as const

const pages = ref<readonly PreviewPage[]>([])
/** 全尺寸查看中打开时点击的页。 */
const viewing = ref<number | null>(null)
const failure = ref<string | null>(null)
const running = ref(false)
let pending = false
let disposed = false

const aspectRatio = computed(() => {
  const [width, height] = PAPER_MM[resolvePdfLayout(props.settings).paper]
  return `${width} / ${height}`
})

async function run(): Promise<void> {
  if (running.value) {
    pending = true
    return
  }
  running.value = true
  const settings = props.settings
  const result = await props.preview(settings)
  running.value = false
  if (disposed) return
  if (pending) {
    pending = false
    void run()
    return
  }
  if (result.ok) {
    const [width, height] = PAPER_MM[resolvePdfLayout(settings).paper].map((mm) => (mm * 72) / 25.4)
    pages.value = result.value.map((svg) => toPage(svg, width, height))
    failure.value = null
  } else {
    pages.value = []
    failure.value =
      result.error.code === 'no-cjk-font' ? '缺少中文字体，无法生成样张。' : '无法生成样张。'
  }
}

/** 页面尺寸取自 SVG 根元素的 width / height（磅）；取不到时按纸张尺寸。 */
function toPage(svg: string, width: number, height: number): PreviewPage {
  const size = /^<svg[^>]*\swidth="([\d.]+)pt"[^>]*\sheight="([\d.]+)pt"/.exec(svg)
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: size ? Number(size[1]) : width,
    height: size ? Number(size[2]) : height,
  }
}

function view(index: number | null): void {
  viewing.value = index
  emit('viewer', index !== null)
}

watch(() => props.settings, run, { immediate: true })

onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <div class="preview" aria-hidden="true">
    <div class="preview__scroller">
      <template v-if="pages.length > 0">
        <img
          v-for="(page, index) in pages"
          :key="index"
          class="preview__page preview__page--zoomable"
          :class="{ 'preview__page--stale': running }"
          :style="{ aspectRatio: `${page.width} / ${page.height}` }"
          :src="page.src"
          alt=""
          draggable="false"
          @click="view(index)"
        />
        <p class="preview__note">样张只排文档开头的部分内容。</p>
      </template>
      <div v-else class="preview__page preview__page--blank" :style="{ aspectRatio }">
        <span v-if="failure" class="preview__message">{{ failure }}</span>
        <span v-else-if="running" class="preview__message preview__message--loading">正在排版…</span>
      </div>
    </div>
    <PdfPageViewer v-if="viewing !== null" :pages="pages" :start="viewing" @close="view(null)" />
  </div>
</template>

<style scoped>
/* 不参与对话框的高度：对话框高度由选项决定，样张在其中滚动。 */
.preview {
  position: relative;
}

.preview__scroller {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  /* 留出页面阴影的空间。 */
  padding: var(--space-1) var(--space-2) var(--space-6);
}

.preview__page {
  display: block;
  width: 100%;
  box-sizing: border-box;
  border-radius: 2px;
  background: #ffffff;
  box-shadow: 0 0 0 0.5px var(--color-control-border), 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: opacity var(--duration-base) var(--ease-out);
}

.preview__page--zoomable {
  cursor: zoom-in;
}

.preview__page + .preview__page {
  margin-top: var(--space-5);
}

/* 重新排版较慢时才淡出，快速切换时不闪烁。 */
.preview__page--stale {
  opacity: 0.55;
  transition-delay: 300ms;
}

.preview__page--blank {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
}

.preview__message {
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  text-align: center;
}

.preview__message--loading {
  animation: preview-appear var(--duration-base) var(--ease-out) 300ms both;
}

@keyframes preview-appear {
  from {
    opacity: 0;
  }
}

.preview__note {
  margin: var(--space-5) 0 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  text-align: center;
}
</style>
