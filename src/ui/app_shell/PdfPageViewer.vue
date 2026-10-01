<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '../common/Icon.vue'

export interface PreviewPage {
  readonly src: string
  /** 页面尺寸（磅）。 */
  readonly width: number
  readonly height: number
}

/**
 * 样张的全尺寸查看：铺满窗口，各页按实际尺寸（100%）竖向排列，打开时定位到点击的那一页。
 * 只用于查看；Esc、点击页面以外的位置或关闭按钮回到排版设置。滚动键在查看层中直接可用。
 */
const props = defineProps<{ pages: readonly PreviewPage[]; start: number }>()

const emit = defineEmits<{ close: [] }>()

const scroller = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null

/** CSS 像素 / 磅。 */
const PX_PER_PT = 96 / 72

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  } else if (event.key === 'Tab') {
    // 查看层只有关闭按钮一个控件。
    event.preventDefault()
    event.stopPropagation()
    closeButton.value?.focus()
  }
}

function onClick(event: MouseEvent): void {
  if (!(event.target instanceof HTMLImageElement)) emit('close')
}

onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', onKeydown, true)
  await nextTick()
  const page = scroller.value?.querySelectorAll('img')[props.start]
  page?.scrollIntoView({ block: 'start' })
  scroller.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <div class="viewer" role="dialog" aria-modal="true" aria-label="样张">
      <div ref="scroller" class="viewer__pages" tabindex="-1" @click="onClick">
        <img
          v-for="(page, index) in pages"
          :key="index"
          class="viewer__page"
          :src="page.src"
          :alt="`第 ${index + 1} 页`"
          :style="{ width: `${page.width * PX_PER_PT}px`, aspectRatio: `${page.width} / ${page.height}` }"
          draggable="false"
        />
      </div>
      <button ref="closeButton" type="button" class="viewer__close" aria-label="关闭样张" @click="emit('close')">
        <Icon name="close" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* 叠在排版设置的遮罩之上，背景再暗一层。 */
.viewer {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  background: var(--color-scrim);
  animation: viewer-fade var(--duration-base) var(--ease-out);
}

@keyframes viewer-fade {
  from {
    opacity: 0;
  }
}

.viewer__pages {
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  padding: var(--space-10) var(--space-8);
  outline: none;
}

.viewer__page {
  display: block;
  max-width: 100%;
  margin: 0 auto;
  border-radius: 2px;
  background: #ffffff;
  box-shadow: var(--shadow-dialog);
  /* 定位到某一页时保留与列表顶部相同的留白。 */
  scroll-margin-top: var(--space-10);
}

.viewer__page + .viewer__page {
  margin-top: var(--space-8);
}

.viewer__close {
  position: absolute;
  top: var(--space-6);
  right: var(--space-6);
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-l);
  height: var(--control-h-l);
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-dialog);
  color: var(--color-text-secondary);
}

.viewer__close:hover {
  color: var(--color-text);
}

.viewer__close:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}
</style>
