<script setup lang="ts">
import type { ImageAlign, ImageLayout, ImageOverride, ImageSize } from '../../domain/document_style/document_style.ts'

/**
 * 选中独立成段的图片时显示的布局按钮：语义化尺寸与对齐，不提供任意像素输入。
 * 当前实际布局（图片自己的设置或主题默认）显示为按下。按钮不抢焦点，图片保持选中。
 */
defineProps<{ layout: ImageLayout }>()

const emit = defineEmits<{ change: [patch: ImageOverride] }>()

const sizes: ReadonlyArray<{ readonly value: ImageSize; readonly label: string; readonly title: string }> = [
  { value: 'original', label: '原始', title: '原始大小（不超过正文宽度）' },
  { value: 'small', label: '小', title: '正文宽度的 40%' },
  { value: 'medium', label: '中', title: '正文宽度的 65%' },
  { value: 'large', label: '大', title: '正文宽度的 85%' },
  { value: 'full', label: '通栏', title: '与正文同宽' },
]

/** 对齐用线条图标：16×16，颜色跟随文字。 */
const aligns: ReadonlyArray<{ readonly value: ImageAlign; readonly label: string; readonly icon: string }> = [
  { value: 'left', label: '靠左', icon: 'M2.5 3v10M5 5.5h6v5H5z' },
  { value: 'center', label: '居中', icon: 'M8 3v2.5M8 10.5V13M5 5.5h6v5H5z' },
  { value: 'right', label: '靠右', icon: 'M13.5 3v10M5 5.5h6v5H5z' },
]
</script>

<template>
  <div class="image-controls" role="toolbar" aria-label="图片布局">
    <div class="image-controls__group" role="group" aria-label="图片尺寸">
      <button
        v-for="size in sizes"
        :key="size.value"
        type="button"
        class="image-controls__button"
        :class="{ 'image-controls__button--active': layout.size === size.value }"
        :aria-pressed="layout.size === size.value"
        :title="size.title"
        @mousedown.prevent
        @click="emit('change', { size: size.value })"
      >
        {{ size.label }}
      </button>
    </div>
    <div class="image-controls__group" role="group" aria-label="图片对齐">
      <button
        v-for="align in aligns"
        :key="align.value"
        type="button"
        class="image-controls__button"
        :class="{ 'image-controls__button--active': layout.align === align.value }"
        :aria-label="align.label"
        :aria-pressed="layout.align === align.value"
        :title="align.label"
        @mousedown.prevent
        @click="emit('change', { align: align.value })"
      >
        <svg class="image-controls__icon" viewBox="0 0 16 16" aria-hidden="true"><path :d="align.icon" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.image-controls {
  display: inline-flex;
  gap: 8px;
}

.image-controls__group {
  display: flex;
  gap: 2px;
}

.image-controls__group + .image-controls__group {
  padding-left: 8px;
  border-left: 1px solid #f3f4f6;
}

.image-controls__button {
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: none;
  color: #374151;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}

.image-controls__button:hover {
  background: rgba(15, 23, 42, 0.06);
}

.image-controls__button--active,
.image-controls__button--active:hover {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}

.image-controls__icon {
  display: block;
  width: 16px;
  height: 16px;
  margin: 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
