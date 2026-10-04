<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
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
  /** 全文字数目标（null 表示没有）与今天新增的字数（docs/decisions.md 第 17 节）。 */
  goal?: number | null
  today?: number | null
}>()

const emit = defineEmits<{ close: []; 'set-goal': [goal: number | null] }>()

/** 正在设置目标（输入框中的文字）。 */
const editingGoal = ref<string | null>(null)

function startGoal(): void {
  editingGoal.value = props.goal ? String(props.goal) : ''
}

function finishGoal(): void {
  const value = Number((editingGoal.value ?? '').replace(/[,，\s]/g, ''))
  editingGoal.value = null
  emit('set-goal', Number.isInteger(value) && value > 0 ? value : null)
}

function percent(): number {
  return props.goal ? Math.min(100, Math.floor((props.document.words / props.goal) * 100)) : 0
}

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
  if (editingGoal.value !== null) {
    event.preventDefault()
    event.stopPropagation()
    editingGoal.value = null
    return
  }
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
    <div class="word-count__goal">
      <template v-if="editingGoal !== null">
        <form class="word-count__goal-form" @submit.prevent="finishGoal">
          <label class="word-count__goal-label" for="word-count-goal">全文目标</label>
          <input
            id="word-count-goal"
            v-model="editingGoal"
            class="word-count__goal-input"
            type="text"
            inputmode="numeric"
            placeholder="如 80000"
            autocomplete="off"
            @vue:mounted="({ el }: { el: HTMLInputElement }) => el.focus()"
          />
          <span class="word-count__goal-unit">字</span>
          <button type="submit" class="word-count__goal-button">完成</button>
        </form>
      </template>
      <template v-else-if="goal">
        <div class="word-count__goal-row">
          <span>目标 {{ format(goal) }} 字</span>
          <span class="word-count__goal-percent">{{ percent() }}%</span>
        </div>
        <div class="word-count__bar" role="progressbar" :aria-valuenow="percent()" aria-valuemin="0" aria-valuemax="100" aria-label="全文目标进度">
          <div class="word-count__bar-fill" :style="{ width: `${percent()}%` }"></div>
        </div>
        <div class="word-count__goal-row word-count__goal-row--meta">
          <span v-if="today !== null && today !== undefined">今天 {{ today >= 0 ? '+' : '' }}{{ format(today) }} 字</span>
          <span v-else></span>
          <span>
            <button type="button" class="word-count__link" @click="startGoal">修改</button>
            <button type="button" class="word-count__link" @click="emit('set-goal', null)">取消目标</button>
          </span>
        </div>
      </template>
      <template v-else>
        <div class="word-count__goal-row word-count__goal-row--meta">
          <span v-if="today !== null && today !== undefined">今天 {{ today >= 0 ? '+' : '' }}{{ format(today) }} 字</span>
          <span v-else></span>
          <button type="button" class="word-count__link" @click="startGoal">设置全文目标…</button>
        </div>
      </template>
    </div>
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

.word-count__goal {
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-separator);
  font-variant-numeric: tabular-nums;
}

.word-count__goal-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-5);
}

.word-count__goal-row--meta {
  align-items: center;
  margin-top: var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
}

.word-count__goal-percent {
  color: var(--color-text-secondary);
}

/* 进度条：细线，强调色只用于已完成的部分。 */
.word-count__bar {
  height: 4px;
  margin-top: var(--space-2);
  overflow: hidden;
  border-radius: 2px;
  background: var(--color-fill-pressed);
}

.word-count__bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--color-accent);
  transition: width var(--duration-slow) var(--ease-out);
}

.word-count__link {
  padding: 0 var(--space-1);
  border: none;
  background: none;
  color: var(--color-accent-text);
  font: inherit;
  font-size: var(--text-s);
}

.word-count__link:hover {
  text-decoration: underline;
}

.word-count__goal-form {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.word-count__goal-label,
.word-count__goal-unit {
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.word-count__goal-input {
  width: 0;
  flex: 1;
  min-width: 5em;
  height: var(--control-h-s);
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-s);
  background: var(--color-bg);
  box-shadow: 0 0 0 1px var(--color-accent), 0 0 0 3px var(--color-accent-fill-strong);
  color: var(--color-text);
  font: inherit;
  outline: none;
}

.word-count__goal-button {
  height: var(--control-h-s);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-s);
  background: var(--color-accent);
  color: var(--color-text-on-accent);
  font: inherit;
  font-size: var(--text-s);
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
