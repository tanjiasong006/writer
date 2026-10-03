<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { renderMath } from './math_view.ts'

/**
 * 编辑公式（docs/decisions.md 第 14 节）：在公式（或插入处）下方弹出，上面是 LaTeX 文本框，下面是实时预览。
 *
 * - Enter 完成，⇧Enter 换行（公式块可以多行），Esc 放弃；点击浮层以外也完成。
 * - 只发出 commit / cancel，正文由编辑器修改。
 */
const props = defineProps<{
  anchor: { readonly x: number; readonly y: number }
  label: string
  tex: string
  display: boolean
}>()

const emit = defineEmits<{
  commit: [tex: string]
  cancel: []
}>()

const value = ref(props.tex)
const panel = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
const preview = ref<HTMLElement | null>(null)
const position = ref<{ left: number; top?: number; bottom?: number } | null>(null)

const EDGE = 8
const GAP = 6
const LINE = 28

function place(): void {
  const element = panel.value
  if (!element) return
  const { x, y } = props.anchor
  const left = Math.max(EDGE, Math.min(x - 24, window.innerWidth - element.offsetWidth - EDGE))
  if (y + GAP + element.offsetHeight <= window.innerHeight - EDGE) position.value = { left, top: y + GAP }
  else position.value = { left, bottom: Math.max(EDGE, window.innerHeight - (y - LINE - GAP)) }
}

function showPreview(): void {
  if (!preview.value) return
  if (value.value.trim() === '') {
    preview.value.textContent = ''
    preview.value.classList.remove('is-invalid')
    return
  }
  renderMath(preview.value, value.value, props.display)
}

watch(value, showPreview)

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    emit('commit', value.value.trim())
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
  }
}

onMounted(async () => {
  showPreview()
  place()
  await nextTick()
  input.value?.focus({ preventScroll: true })
  input.value?.select()
})
</script>

<template>
  <div class="math-popover__backdrop" @mousedown.prevent="emit('commit', value.trim())"></div>
  <div
    ref="panel"
    class="math-popover"
    role="dialog"
    :aria-label="label"
    :style="
      position
        ? {
            left: `${position.left}px`,
            top: position.top === undefined ? undefined : `${position.top}px`,
            bottom: position.bottom === undefined ? undefined : `${position.bottom}px`,
          }
        : { visibility: 'hidden' }
    "
  >
    <div class="math-popover__label">{{ label }}</div>
    <div class="math-popover__field" :data-value="value">
      <textarea
        ref="input"
        v-model="value"
        class="math-popover__input"
        rows="1"
        placeholder="LaTeX，如 \frac{a}{b}"
        aria-label="LaTeX"
        spellcheck="false"
        autocomplete="off"
        @keydown="onKeydown"
      ></textarea>
    </div>
    <div ref="preview" class="math-popover__preview document-body" aria-live="polite"></div>
    <div class="math-popover__hint">↩ 完成　⇧↩ 换行　⎋ 取消</div>
  </div>
</template>

<style scoped>
.math-popover__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.math-popover {
  position: fixed;
  z-index: calc(var(--z-popover) + 1);
  width: 420px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  padding: var(--space-4) var(--space-5) var(--space-3);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-popover);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  animation: math-popover-in var(--duration-fast) var(--ease-out);
}

@keyframes math-popover-in {
  from {
    opacity: 0;
  }
}

.math-popover__label {
  margin-bottom: var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  -webkit-user-select: none;
  user-select: none;
}

/* 随内容增高的文本框（与脚注浮层相同的做法），等宽字体。 */
.math-popover__field {
  display: grid;
  max-height: 200px;
  overflow-y: auto;
}

.math-popover__field::after,
.math-popover__input {
  grid-area: 1 / 1;
  box-sizing: border-box;
  margin: 0;
  padding: var(--space-2) 0;
  border: none;
  font-family: var(--font-mono);
  font-size: var(--text-m);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.math-popover__field::after {
  content: attr(data-value) ' ';
  visibility: hidden;
}

.math-popover__input {
  width: 0;
  min-width: 100%;
  overflow: hidden;
  resize: none;
  background: transparent;
  color: inherit;
  outline: none;
}

.math-popover__input::placeholder {
  color: var(--color-text-tertiary);
}

/* 预览：与正文相同的字体与颜色，过宽时横向滚动。 */
.math-popover__preview {
  min-height: 1.6em;
  margin-top: var(--space-3);
  padding: var(--space-4);
  overflow-x: auto;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  text-align: center;
}

.math-popover__preview.is-invalid {
  color: var(--color-danger-text);
  font-family: var(--font-mono);
  font-size: var(--text-s);
}

.math-popover__hint {
  margin-top: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-separator);
  color: var(--color-text-tertiary);
  font-size: var(--text-xs);
  text-align: right;
  -webkit-user-select: none;
  user-select: none;
}
</style>
