<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import type { BrokenChapterRef } from '../editor/chapter_ref_update.ts'

/**
 * “更新交叉引用”的结果（docs/decisions.md 第 9 节）：第一行是结论，下面列出失效引用。
 *
 * - 模态，外观与文档信息对话框一致。打开时焦点在“完成”，Enter / Esc 关闭，Tab 只在对话框内循环。
 * - 单击一处失效引用：跳到它所在的位置（select），对话框随之关闭。
 */
const props = defineProps<{
  /** 写回的章节数与更新的引用数。 */
  chapters: number
  updated: number
  broken: readonly BrokenChapterRef[]
  /** 章节的完整名称（编号 + 标题）。 */
  chapterName: (chapterId: ChapterId) => string
}>()

const emit = defineEmits<{
  select: [ref: BrokenChapterRef]
  close: []
}>()

const dialog = ref<HTMLElement | null>(null)
const done = ref<HTMLButtonElement | null>(null)

const summary =
  props.updated > 0
    ? `已更新 ${props.chapters} 个章节中的 ${props.updated} 处引用文字。`
    : props.broken.length > 0
      ? '没有需要更新的引用文字。'
      : '所有引用都是最新的。'

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  event.preventDefault()
  event.stopPropagation()
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button') ?? [])]
  if (controls.length === 0) return
  const index = controls.indexOf(document.activeElement as HTMLElement)
  const next = index === -1 ? 0 : index + (event.shiftKey ? -1 : 1)
  controls[(next + controls.length) % controls.length].focus()
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown, true)
  await nextTick()
  done.value?.focus()
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="ref-report__scrim">
    <div
      ref="dialog"
      class="ref-report"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ref-report-title"
      aria-describedby="ref-report-summary"
    >
      <h2 id="ref-report-title" class="ref-report__title">更新交叉引用</h2>
      <p id="ref-report-summary" class="ref-report__summary">{{ summary }}</p>
      <template v-if="broken.length > 0">
        <p class="ref-report__heading">{{ broken.length }} 处引用已失效（目标章节不存在），导出时按原来的文字输出：</p>
        <ul class="ref-report__list">
          <li v-for="item in broken" :key="`${item.chapterId}:${item.index}`">
            <button type="button" class="ref-report__item" @click="emit('select', item)">
              <span class="ref-report__chapter">{{ chapterName(item.chapterId) }}</span>
              <span class="ref-report__context">{{ item.before }}<span class="ref-report__broken">{{ item.text }}</span>{{ item.after }}</span>
            </button>
          </li>
        </ul>
      </template>
      <div class="ref-report__actions">
        <button ref="done" type="button" class="ref-report__button" @click="emit('close')">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ref-report__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 18vh;
  background: var(--color-scrim);
  animation: ref-report-fade var(--duration-base) var(--ease-out);
}

@keyframes ref-report-fade {
  from {
    opacity: 0;
  }
}

.ref-report {
  width: 440px;
  max-width: calc(100vw - 2 * var(--space-8));
  box-sizing: border-box;
  padding: var(--space-7) var(--space-7) var(--space-6);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-dialog);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  animation: ref-report-in var(--duration-slow) var(--ease-out);
}

@keyframes ref-report-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
}

.ref-report__title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-l);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-normal);
}

.ref-report__summary {
  margin: 0 0 var(--space-6);
  color: var(--color-text-secondary);
}

.ref-report__heading {
  margin: 0 0 var(--space-3);
  color: var(--color-text-secondary);
}

.ref-report__list {
  max-height: 240px;
  margin: 0 calc(-1 * var(--space-3)) var(--space-6);
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.ref-report__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: default;
}

.ref-report__item:hover {
  background: var(--color-fill-hover);
}

.ref-report__item:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}

.ref-report__chapter {
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
}

.ref-report__context {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ref-report__broken {
  color: var(--color-danger-text);
  text-decoration: underline dotted var(--color-danger);
  text-underline-offset: 0.18em;
}

.ref-report__actions {
  display: flex;
  justify-content: flex-end;
}

.ref-report__button {
  min-width: 72px;
  height: var(--control-h-m);
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-accent);
  color: var(--color-text-on-accent);
  font: inherit;
  font-weight: var(--weight-medium);
}

.ref-report__button:hover {
  background: var(--color-accent-hover);
}

.ref-report__button:focus {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}
</style>
