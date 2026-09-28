<script setup lang="ts">
import type { ImageAlign, ImageLayout, ImageOverride, ImageSize } from '../../domain/document_style/document_style.ts'
import Icon from '../common/Icon.vue'
import type { IconName } from '../common/icons.ts'

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

const aligns: ReadonlyArray<{ readonly value: ImageAlign; readonly label: string; readonly icon: IconName }> = [
  { value: 'left', label: '靠左', icon: 'align-left' },
  { value: 'center', label: '居中', icon: 'align-center' },
  { value: 'right', label: '靠右', icon: 'align-right' },
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
        <Icon :name="align.icon" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 与正文工具栏同一套按钮：尺寸是一组文字按钮，对齐是一组图标按钮。 */
.image-controls {
  display: inline-flex;
  align-items: center;
  gap: var(--space-5);
}

.image-controls__group {
  display: flex;
  gap: var(--space-1);
}

.image-controls__button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: var(--control-h-m);
  height: var(--control-h-m);
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--text-m);
  white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.image-controls__button:hover {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.image-controls__button--active,
.image-controls__button--active:hover {
  background: var(--color-accent-fill);
  color: var(--color-accent-text);
}
</style>
