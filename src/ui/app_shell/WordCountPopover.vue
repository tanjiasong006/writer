<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import type { TextCount } from '../../domain/word_count/word_count.ts'

/**
 * 字数统计浮层（工具栏字数的详细信息）：选中内容、本章与全文的字数与字符数（不含空白）。
 * 在按钮下方右对齐弹出；点击浮层以外或按 Esc 关闭。只显示，不修改任何内容。
 */
const props = defineProps<{
  /** 按钮的位置。 */
  anchor: { readonly right: number; readonly bottom: number }
  selection: TextCount | null
  chapter: TextCount
  document: TextCount
}>()

const emit = defineEmits<{ close: [] }>()

function format(value: number): string {
  return value.toLocaleString('zh-CN')
}

const rows = () =>
  [
    props.selection ? { label: '选中内容', count: props.selection } : null,
    { label: '本章', count: props.chapter },
    { label: '全文', count: props.document },
  ].filter((row) => row !== null)

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="word-count__backdrop" @mousedown.prevent @click="emit('close')"></div>
  <div
    class="word-count"
    role="dialog"
    aria-label="字数统计"
    :style="{ right: `${Math.max(8, anchor.right)}px`, top: `${anchor.bottom + 4}px` }"
  >
    <table class="word-count__table">
      <thead>
        <tr>
          <th scope="col"></th>
          <th scope="col">字数</th>
          <th scope="col">字符数（不含空格）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows()" :key="row.label">
          <th scope="row">{{ row.label }}</th>
          <td>{{ format(row.count.words) }}</td>
          <td>{{ format(row.count.characters) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="word-count__note">汉字与中文标点逐字计，英文按词计，不含章节标题。</p>
  </div>
</template>

<style scoped>
.word-count__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.word-count {
  position: fixed;
  z-index: calc(var(--z-popover) + 1);
  box-sizing: border-box;
  padding: var(--space-5) var(--space-6) var(--space-4);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-popover);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  animation: word-count-in var(--duration-fast) var(--ease-out);
  -webkit-user-select: text;
  user-select: text;
}

@keyframes word-count-in {
  from {
    opacity: 0;
  }
}

.word-count__table {
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.word-count__table th,
.word-count__table td {
  padding: var(--space-1) 0;
  font-weight: normal;
  text-align: right;
  white-space: nowrap;
}

.word-count__table th + th,
.word-count__table td {
  padding-left: var(--space-8);
}

.word-count__table thead th {
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
}

.word-count__table tbody th {
  color: var(--color-text-secondary);
  text-align: left;
}

.word-count__note {
  /* 不撑宽浮层：宽度跟随上方的表格。 */
  width: 0;
  min-width: 100%;
  margin: var(--space-4) 0 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  line-height: var(--leading-tight);
}
</style>
