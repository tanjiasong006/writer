<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import Icon from '../common/Icon.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import type { FindScope } from './use_find.ts'

/**
 * 查找栏：在工具栏下方，与正文同宽的一行（展开替换时两行）。
 *
 * - 查找框中 Enter 下一个、⇧Enter 上一个，Esc 关闭查找栏（焦点回到正文，选中当前匹配）。
 * - 右侧显示“第 3 处，共 12 处”；没有匹配时说明“无结果”。
 * - 范围：本章 / 全文。替换行：替换（当前匹配并前进）、全部替换（范围内全部）。
 * - 只发出事件，查找与替换由工作区（use_find.ts）完成。
 */
const props = defineProps<{
  query: string
  replacement: string
  scope: FindScope
  showReplace: boolean
  total: number
  /** 当前匹配的序号（从 1 开始）；选区不是匹配时为 null。 */
  position: number | null
  /** 最近一次全部替换的数量。 */
  replacedCount: number | null
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  'update:replacement': [value: string]
  'update:scope': [value: FindScope]
  'update:showReplace': [value: boolean]
  next: []
  previous: []
  replace: []
  'replace-all': []
  close: []
}>()

const SCOPES = [
  { value: 'chapter', label: '本章' },
  { value: 'document', label: '全文' },
] as const satisfies ReadonlyArray<{ value: FindScope; label: string }>

const queryInput = ref<HTMLInputElement | null>(null)

const status = computed(() => {
  if (props.replacedCount !== null) return `已替换 ${props.replacedCount} 处`
  if (props.query === '') return ''
  if (props.total === 0) return '无结果'
  return props.position === null ? `共 ${props.total} 处` : `第 ${props.position} 处，共 ${props.total} 处`
})

/** 聚焦查找框并选中其中的文字（再次按 ⌘F 时也调用）。 */
function focusQuery(): void {
  queryInput.value?.focus()
  queryInput.value?.select()
}

onMounted(async () => {
  await nextTick()
  focusQuery()
})

function onQueryKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  if (event.shiftKey) emit('previous')
  else emit('next')
}

function onReplaceKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  emit('replace')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

defineExpose({ focusQuery })
</script>

<template>
  <div class="find-bar" role="search" aria-label="查找" @keydown="onKeydown">
    <div class="find-bar__row">
      <button
        type="button"
        class="find-bar__tool find-bar__disclosure"
        :aria-expanded="showReplace"
        :aria-label="showReplace ? '隐藏替换' : '显示替换'"
        :title="showReplace ? '隐藏替换' : '显示替换'"
        @click="emit('update:showReplace', !showReplace)"
      >
        <Icon :name="showReplace ? 'chevron-down' : 'chevron-right'" />
      </button>
      <div class="find-bar__field">
        <Icon name="search" class="find-bar__field-icon" />
        <input
          ref="queryInput"
          class="find-bar__input"
          type="text"
          :value="query"
          placeholder="查找"
          aria-label="查找"
          spellcheck="false"
          autocomplete="off"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
          @keydown="onQueryKeydown"
        />
        <span class="find-bar__status" :class="{ 'find-bar__status--none': query !== '' && total === 0 && replacedCount === null }" aria-live="polite">
          {{ status }}
        </span>
      </div>
      <div class="find-bar__steps">
        <button
          type="button"
          class="find-bar__tool"
          aria-label="上一个"
          title="上一个（⇧↩）"
          :disabled="total === 0"
          @click="emit('previous')"
        >
          <Icon name="chevron-up" />
        </button>
        <button
          type="button"
          class="find-bar__tool"
          aria-label="下一个"
          title="下一个（↩）"
          :disabled="total === 0"
          @click="emit('next')"
        >
          <Icon name="chevron-down" />
        </button>
      </div>
      <SegmentedControl
        class="find-bar__scope"
        :model-value="scope"
        :options="SCOPES"
        label="查找范围"
        @update:model-value="emit('update:scope', $event)"
      />
      <button type="button" class="find-bar__button" @click="emit('close')">完成</button>
    </div>
    <div v-if="showReplace" class="find-bar__row">
      <span class="find-bar__disclosure-space" aria-hidden="true"></span>
      <div class="find-bar__field">
        <!-- 与查找框的文字左边缘对齐。 -->
        <input
          class="find-bar__input find-bar__input--indented"
          type="text"
          :value="replacement"
          placeholder="替换为"
          aria-label="替换为"
          spellcheck="false"
          autocomplete="off"
          @input="emit('update:replacement', ($event.target as HTMLInputElement).value)"
          @keydown="onReplaceKeydown"
        />
      </div>
      <button type="button" class="find-bar__button" :disabled="total === 0" @click="emit('replace')">替换</button>
      <button type="button" class="find-bar__button" :disabled="total === 0" @click="emit('replace-all')">全部替换</button>
    </div>
  </div>
</template>

<style scoped>
/* 查找栏：与工具栏同底色，只用下方一条分隔线与正文分开。 */
.find-bar {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--color-separator);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  -webkit-user-select: none;
  user-select: none;
}

.find-bar__row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.find-bar__disclosure-space {
  flex: none;
  width: var(--control-h-s);
}

.find-bar__field {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  max-width: 480px;
  height: var(--control-h-m);
  box-sizing: border-box;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
}

.find-bar__field:focus-within {
  background: var(--color-bg);
  box-shadow: 0 0 0 1px var(--color-accent), 0 0 0 3px var(--color-accent-fill-strong);
}

.find-bar__field-icon {
  position: absolute;
  left: var(--space-3);
  width: var(--icon-s);
  height: var(--icon-s);
  color: var(--color-text-tertiary);
  pointer-events: none;
}

.find-bar__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0 var(--space-3);
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  outline: none;
  -webkit-user-select: text;
  user-select: text;
}

.find-bar__field-icon + .find-bar__input,
.find-bar__input--indented {
  padding-left: calc(var(--space-3) + var(--icon-s) + var(--space-3));
}

.find-bar__input::placeholder {
  color: var(--color-text-tertiary);
}

.find-bar__status {
  flex: none;
  padding-right: var(--space-4);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.find-bar__status--none {
  color: var(--color-danger-text);
}

.find-bar__steps {
  display: flex;
  flex: none;
  gap: var(--space-1);
}

.find-bar__scope {
  flex: none;
}

/* 与工具栏按钮相同的无边框图标按钮，尺寸小一号。 */
.find-bar__tool {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--control-h-s);
  height: var(--control-h-s);
  padding: 0;
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--color-text-secondary);
}

.find-bar__tool:hover:not(:disabled) {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.find-bar__tool:active:not(:disabled) {
  background: var(--color-fill-pressed);
}

.find-bar__tool:disabled {
  color: var(--color-text-disabled);
}

.find-bar__tool:focus-visible,
.find-bar__button:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
}

.find-bar__button {
  flex: none;
  height: var(--control-h-s);
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  box-shadow: inset 0 0 0 1px var(--color-separator);
  color: var(--color-text);
  font: inherit;
}

.find-bar__button:hover:not(:disabled) {
  background: var(--color-fill-pressed);
}

.find-bar__button:disabled {
  color: var(--color-text-disabled);
}
</style>
