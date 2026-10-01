<script setup lang="ts">
import { computed } from 'vue'
import type { PdfLayout } from '../../domain/pdf_layout/pdf_layout.ts'

/**
 * PDF 排版设置旁的页面示意：一张正文右页，随设置即时变化（纸张比例、页边距与装订侧、页眉、
 * 行距与段落样式、表格样式、页码格式与位置）。只是示意，不是分页预览，对读屏软件隐藏。
 */
const props = defineProps<{ layout: PdfLayout }>()

/** 示意页的高度（px）；宽度按纸张比例。 */
const PAGE_H = 236

const PAPER_MM = {
  a4: [210, 297],
  b5: [176, 250],
  a5: [148, 210],
  letter: [215.9, 279.4],
} as const

const MARGIN_MM = { narrow: 18, normal: 25, wide: 32 } as const

const LINE_PITCH = { compact: 6, normal: 7, loose: 8 } as const

const geometry = computed(() => {
  const [width, height] = PAPER_MM[props.layout.paper]
  const scale = PAGE_H / height
  const margin = MARGIN_MM[props.layout.margin]
  // 右页：装订侧（内侧）在左边。
  const shift = props.layout.binding === 'double' ? 5 : 0
  return {
    width: width * scale,
    top: margin * scale,
    left: (margin + shift) * scale,
    right: (margin - shift) * scale,
  }
})

/** 两段正文的行：每段 4 行，末行短一些；首行缩进时第一行留出缩进。 */
const paragraphs = [
  [1, 1, 1, 0.55],
  [1, 1, 1, 0.7],
]

const pageNumber = computed(() => {
  switch (props.layout.pageNumber) {
    case 'plain':
      return '7'
    case 'page':
      return '第 7 页'
    case 'total':
      return '7 / 24'
  }
})
</script>

<template>
  <div class="schematic" aria-hidden="true">
    <div
      class="schematic__page"
      :class="{ 'schematic__page--double': layout.binding === 'double' }"
      :style="{ width: `${geometry.width}px`, height: `${PAGE_H}px` }"
    >
      <div
        class="schematic__area"
        :style="{ top: `${geometry.top}px`, bottom: `${geometry.top}px`, left: `${geometry.left}px`, right: `${geometry.right}px` }"
      >
        <div v-if="layout.header !== 'none'" class="schematic__header">
          <span v-if="layout.binding === 'single'" class="schematic__bar schematic__bar--meta" style="width: 32%" />
          <span
            v-if="layout.header === 'titleAndChapter' || layout.binding === 'double'"
            class="schematic__bar schematic__bar--meta schematic__header-right"
            style="width: 26%"
          />
        </div>
        <div class="schematic__heading" />
        <div
          v-for="(lines, p) in paragraphs"
          :key="p"
          class="schematic__paragraph"
          :style="{ marginTop: p > 0 && layout.paragraph === 'spacing' ? '5px' : '0' }"
        >
          <span
            v-for="(length, l) in lines"
            :key="l"
            class="schematic__bar"
            :style="{
              width: `${length * 100}%`,
              marginTop: `${LINE_PITCH[layout.lineHeight] - 2}px`,
              marginLeft: l === 0 && layout.paragraph === 'indent' ? '12%' : '0',
              maxWidth: l === 0 && layout.paragraph === 'indent' ? '88%' : '100%',
            }"
          />
        </div>
        <div class="schematic__table" :class="`schematic__table--${layout.table}`">
          <span v-for="cell in 6" :key="cell" class="schematic__cell" />
        </div>
      </div>
      <span
        class="schematic__number"
        :class="{ 'schematic__number--outside': layout.binding === 'double' }"
        :style="layout.binding === 'double' ? { right: `${geometry.right}px` } : undefined"
      >
        {{ pageNumber }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.schematic {
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.schematic__page {
  position: relative;
  box-sizing: border-box;
  border-radius: 2px;
  background: #ffffff;
  box-shadow: 0 0 0 0.5px var(--color-control-border), 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: width var(--duration-base) var(--ease-out);
}

/* 双面装订：左侧（装订侧）一道浅色阴影。 */
.schematic__page--double {
  background: linear-gradient(to right, rgba(0, 0, 0, 0.06), transparent 6px), #ffffff;
}

.schematic__area {
  position: absolute;
  display: flex;
  flex-direction: column;
  transition:
    left var(--duration-base) var(--ease-out),
    right var(--duration-base) var(--ease-out),
    top var(--duration-base) var(--ease-out),
    bottom var(--duration-base) var(--ease-out);
}

/* 示意页始终是白纸黑字，与界面外观无关。 */
.schematic__bar {
  display: block;
  height: 2px;
  border-radius: 1px;
  background: rgba(0, 0, 0, 0.28);
}

.schematic__bar--meta {
  height: 1.5px;
  background: rgba(0, 0, 0, 0.2);
}

.schematic__header {
  position: absolute;
  top: -10px;
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  height: 6px;
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.25);
}

.schematic__header-right {
  margin-left: auto;
}

.schematic__heading {
  width: 45%;
  height: 4px;
  border-radius: 1px;
  background: rgba(0, 0, 0, 0.6);
}

.schematic__table {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 8px;
}

.schematic__cell {
  height: 6px;
}

.schematic__table--grid {
  border-top: 0.5px solid rgba(0, 0, 0, 0.4);
  border-left: 0.5px solid rgba(0, 0, 0, 0.4);
}

.schematic__table--grid .schematic__cell {
  border-right: 0.5px solid rgba(0, 0, 0, 0.4);
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.4);
}

.schematic__table--threeLine {
  border-top: 1px solid rgba(0, 0, 0, 0.6);
  border-bottom: 1px solid rgba(0, 0, 0, 0.6);
}

.schematic__table--threeLine .schematic__cell:nth-child(-n + 3) {
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.45);
}

.schematic__number {
  position: absolute;
  right: 0;
  bottom: 6px;
  left: 0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 7px;
  line-height: 1;
  text-align: center;
}

.schematic__number--outside {
  left: auto;
  text-align: right;
}
</style>
