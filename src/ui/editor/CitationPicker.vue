<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { formatReference, type ReferenceEntry } from '../../domain/bibliography/bibliography.ts'

/**
 * 选择要引用的文献（docs/decisions.md 第 13 节）：在光标下方弹出，与章节引用的浮层相同的交互。
 *
 * - 列出文档的全部参考文献（著录文字，已被引用的显示编号）；按作者、题名等任意文字筛选。
 * - ↑ / ↓ 选择，Enter 确定，Esc 取消；点击确定，点击外部取消。
 * - 底部“管理参考文献…”打开参考文献对话框（manage）；没有文献时说明并提供同一入口。
 * - 只发出事件，不修改正文。
 */
const props = defineProps<{
  references: readonly ReferenceEntry[]
  /** 已被引用的文献的编号。 */
  numbers: ReadonlyMap<string, number>
  anchor: { readonly x: number; readonly y: number }
  /** 更改已有引用时它当前的文献。 */
  current?: string | null
}>()

const emit = defineEmits<{
  pick: [id: string]
  manage: []
  cancel: []
}>()

const rows = computed(() =>
  props.references.map((entry) => ({ id: entry.id, text: formatReference(entry), number: props.numbers.get(entry.id) ?? null })),
)

const query = ref('')
const visible = computed(() => {
  const text = query.value.trim().toLowerCase()
  return text === '' ? rows.value : rows.value.filter((row) => row.text.toLowerCase().includes(text))
})

const active = ref(Math.max(0, rows.value.findIndex((row) => row.id === props.current)))
watch(query, () => (active.value = 0))

const id = useId()
const optionId = (index: number) => `${id}-option-${index}`
const panel = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const manage = ref<HTMLButtonElement | null>(null)
const position = ref<{ left: number; top?: number; bottom?: number } | null>(null)

const EDGE = 8
const GAP = 4
const LINE = 28

function place(): void {
  const element = panel.value
  if (!element) return
  const { x, y } = props.anchor
  const left = Math.max(EDGE, Math.min(x, window.innerWidth - element.offsetWidth - EDGE))
  if (y + GAP + element.offsetHeight <= window.innerHeight - EDGE) position.value = { left, top: y + GAP }
  else position.value = { left, bottom: Math.max(EDGE, window.innerHeight - Math.max(y - LINE - GAP, element.offsetHeight + EDGE)) }
}

function reveal(): void {
  list.value?.querySelector(`#${CSS.escape(optionId(active.value))}`)?.scrollIntoView({ block: 'nearest' })
}

onMounted(async () => {
  place()
  // 没有文献时焦点在“添加文献…”上（Esc 仍然取消）。
  ;(input.value ?? manage.value)?.focus({ preventScroll: true })
  await nextTick()
  reveal()
})

watch(active, () => void nextTick(reveal))

function pick(index: number): void {
  const row = visible.value[index]
  if (row) emit('pick', row.id)
}

function onInputKeydown(event: KeyboardEvent): void {
  const count = visible.value.length
  if (event.key === 'ArrowDown' && count > 0) active.value = (active.value + 1) % count
  else if (event.key === 'ArrowUp' && count > 0) active.value = (active.value - 1 + count) % count
  else if (event.key === 'Enter' && !event.isComposing) pick(active.value)
  else return
  event.preventDefault()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  emit('cancel')
}
</script>

<template>
  <div class="citation-picker__backdrop" @mousedown.prevent @click="emit('cancel')"></div>
  <div
    ref="panel"
    class="citation-picker"
    role="dialog"
    aria-label="插入文献引用"
    :style="
      position
        ? {
            left: `${position.left}px`,
            top: position.top === undefined ? undefined : `${position.top}px`,
            bottom: position.bottom === undefined ? undefined : `${position.bottom}px`,
          }
        : { visibility: 'hidden' }
    "
    @keydown="onKeydown"
  >
    <input
      v-if="references.length > 0"
      ref="input"
      v-model="query"
      class="citation-picker__search"
      type="text"
      placeholder="搜索文献"
      role="combobox"
      aria-label="搜索文献"
      aria-autocomplete="list"
      aria-expanded="true"
      :aria-controls="`${id}-list`"
      :aria-activedescendant="visible.length > 0 ? optionId(active) : undefined"
      spellcheck="false"
      autocomplete="off"
      @keydown="onInputKeydown"
    />
    <div v-if="references.length > 0" :id="`${id}-list`" ref="list" class="citation-picker__list" role="listbox" aria-label="参考文献">
      <div
        v-for="(row, index) in visible"
        :id="optionId(index)"
        :key="row.id"
        class="citation-picker__option"
        :class="{ 'citation-picker__option--active': index === active }"
        role="option"
        :aria-selected="index === active"
        @mousemove="active = index"
        @mousedown.prevent
        @click="pick(index)"
      >
        <span class="citation-picker__number">{{ row.number === null ? '' : `[${row.number}]` }}</span>
        <span class="citation-picker__text">{{ row.text }}</span>
      </div>
      <p v-if="visible.length === 0" class="citation-picker__empty">没有匹配的文献</p>
    </div>
    <p v-else class="citation-picker__empty citation-picker__empty--none">这份文档还没有参考文献。</p>
    <div class="citation-picker__footer">
      <button ref="manage" type="button" class="citation-picker__manage" @mousedown.prevent @click="emit('manage')">
        {{ references.length > 0 ? '管理参考文献…' : '添加文献…' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.citation-picker__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.citation-picker {
  position: fixed;
  z-index: calc(var(--z-popover) + 1);
  display: flex;
  flex-direction: column;
  width: 420px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  padding: var(--space-2);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-popover);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  animation: citation-picker-in var(--duration-fast) var(--ease-out);
}

@keyframes citation-picker-in {
  from {
    opacity: 0;
  }
}

.citation-picker__search {
  height: var(--control-h-m);
  margin: 0 0 var(--space-2);
  padding: 0 var(--space-4);
  border: none;
  border-bottom: 1px solid var(--color-separator);
  background: none;
  color: inherit;
  font: inherit;
  outline: none;
}

.citation-picker__search::placeholder {
  color: var(--color-text-tertiary);
}

.citation-picker__list {
  max-height: 300px;
  overflow-y: auto;
}

/* 每条文献最多两行，编号在左侧成一列。 */
.citation-picker__option {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-m);
  cursor: default;
}

.citation-picker__option--active {
  background: var(--color-accent);
  color: var(--color-text-on-accent);
}

.citation-picker__number {
  flex: none;
  min-width: 2.2em;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.citation-picker__option--active .citation-picker__number {
  color: inherit;
  opacity: 0.75;
}

.citation-picker__text {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.citation-picker__empty {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--color-text-tertiary);
}

.citation-picker__empty--none {
  padding: var(--space-5) var(--space-4);
}

.citation-picker__footer {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
  padding: var(--space-3) var(--space-2) var(--space-1);
  border-top: 1px solid var(--color-separator);
}

.citation-picker__manage {
  height: var(--control-h-s);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: var(--color-accent-text);
  font: inherit;
}

.citation-picker__manage:hover {
  background: var(--color-fill-hover);
}

.citation-picker__manage:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
}
</style>
