<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

/**
 * 编辑一段短文字的浮层（脚注内容、表格标题）：在对象（或插入处）下方弹出，下方放不下时在上方。
 *
 * - 标题（如“脚注 2”“表格标题”）与一个随内容增高的文本框；内容只有一段文字，换行替换为空格。
 * - Enter 完成，Esc 放弃；点击浮层以外也完成（与图注相同，不丢失已输入的内容）。
 * - 只发出 commit / cancel，正文由编辑器修改；焦点由编辑器放回正文。
 */
const props = defineProps<{
  anchor: { readonly x: number; readonly y: number }
  label: string
  text: string
  placeholder: string
  /** 多行内容（章节备注）：⇧Enter 换行，保留换行。 */
  multiline?: boolean
}>()

const emit = defineEmits<{
  commit: [text: string]
  cancel: []
}>()

const value = ref(props.text)
const panel = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
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

function commit(): void {
  emit('commit', props.multiline ? value.value.trim() : value.value.replace(/\s*\n\s*/g, ' ').trim())
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Enter' && !(props.multiline && event.shiftKey)) {
    event.preventDefault()
    commit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
  }
}

onMounted(async () => {
  place()
  await nextTick()
  input.value?.focus({ preventScroll: true })
  input.value?.select()
})
</script>

<template>
  <div class="text-popover__backdrop" @mousedown.prevent="commit"></div>
  <div
    ref="panel"
    class="text-popover"
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
    <div class="text-popover__label">{{ label }}</div>
    <div class="text-popover__field" :data-value="value">
      <textarea
        ref="input"
        v-model="value"
        class="text-popover__input"
        rows="1"
        :placeholder="placeholder"
        :aria-label="placeholder"
        @keydown="onKeydown"
      ></textarea>
    </div>
    <div class="text-popover__hint">{{ multiline ? '↩ 完成　⇧↩ 换行　⎋ 取消' : '↩ 完成　⎋ 取消' }}</div>
  </div>
</template>

<style scoped>
.text-popover__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.text-popover {
  position: fixed;
  z-index: calc(var(--z-popover) + 1);
  width: 360px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  padding: var(--space-4) var(--space-5) var(--space-3);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-popover);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  animation: text-popover-in var(--duration-fast) var(--ease-out);
}

@keyframes text-popover-in {
  from {
    opacity: 0;
  }
}

.text-popover__label {
  margin-bottom: var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  -webkit-user-select: none;
  user-select: none;
}

/* 随内容增高的文本框：隐藏的同内容 ::after 与文本框放在同一网格格中撑开高度（与图注相同）。 */
.text-popover__field {
  display: grid;
  max-height: 240px;
  overflow-y: auto;
}

.text-popover__field::after,
.text-popover__input {
  grid-area: 1 / 1;
  box-sizing: border-box;
  margin: 0;
  padding: var(--space-2) 0;
  border: none;
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.text-popover__field::after {
  content: attr(data-value) ' ';
  visibility: hidden;
}

.text-popover__input {
  overflow: hidden;
  resize: none;
  background: transparent;
  color: inherit;
  outline: none;
}

.text-popover__input::placeholder {
  color: var(--color-text-tertiary);
}

.text-popover__hint {
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
