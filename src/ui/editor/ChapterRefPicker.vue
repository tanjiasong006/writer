<script lang="ts">
import type { ChapterRefShow } from '../../domain/chapter_reference/chapter_reference.ts'

/** 本次运行中上次选择的显示格式（不持久化，docs/decisions.md 第 9 节）。 */
let lastShow: ChapterRefShow = 'number-title'
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import SegmentedControl from '../common/SegmentedControl.vue'

/**
 * 选择章节引用的目标（docs/decisions.md 第 9 节）：在光标下方弹出。
 *
 * - 按章节树顺序与缩进列出全部章节（含当前章节），编号弱于标题；输入时按标题或编号筛选（结果不缩进）。
 * - 焦点在搜索框：↑ / ↓ 选择，Enter 确定，Esc 取消；Tab 到底部的显示格式（←/→ 切换）。
 *   点击章节直接确定，点击浮层以外取消。
 * - 显示格式默认是本次运行中上次的选择；更改已有引用时是它当前的格式，并预先选中它的目标。
 * - 只发出 pick / cancel，不修改正文；焦点由调用方放回正文。
 */
const props = defineProps<{
  tree: ChapterTree
  anchor: { readonly x: number; readonly y: number }
  /** 更改已有引用时：它当前的目标（失效时为 null）与格式。 */
  current?: { readonly id: ChapterId | null; readonly show: ChapterRefShow } | null
}>()

const emit = defineEmits<{
  pick: [id: ChapterId, show: ChapterRefShow]
  cancel: []
}>()

const SHOW_OPTIONS = [
  { value: 'number-title', label: '编号 + 标题' },
  { value: 'number', label: '仅编号' },
  { value: 'title', label: '仅标题' },
] as const satisfies ReadonlyArray<{ value: ChapterRefShow; label: string }>

interface Row {
  readonly id: ChapterId
  readonly number: string
  readonly title: string
  readonly depth: number
}

const rows = computed<Row[]>(() => {
  const numbers = computeChapterNumbers(props.tree)
  const out: Row[] = []
  const visit = (nodes: ChapterTree, depth: number): void => {
    for (const node of nodes) {
      out.push({ id: node.id, number: (numbers.get(node.id) ?? []).join('.'), title: node.title, depth })
      visit(node.children, depth + 1)
    }
  }
  visit(props.tree, 0)
  return out
})

const query = ref('')
const show = ref<ChapterRefShow>(props.current?.show ?? lastShow)

const visible = computed(() => {
  const text = query.value.trim().toLowerCase()
  if (text === '') return rows.value
  return rows.value.filter((row) => row.title.toLowerCase().includes(text) || row.number.startsWith(text))
})

const active = ref(Math.max(0, rows.value.findIndex((row) => row.id === props.current?.id)))
watch(query, () => (active.value = 0))

const id = useId()
const optionId = (index: number) => `${id}-option-${index}`

const panel = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
/** 放在光标下方时按上边缘定位；放在上方时按下边缘定位，筛选使列表变短时浮层仍贴着光标。 */
const position = ref<{ left: number; top?: number; bottom?: number } | null>(null)

/** 与窗口边缘、光标之间的距离。 */
const EDGE = 8
const GAP = 4
/** 光标所在行的高度（浮层放在光标上方时让开）。 */
const LINE = 28

function place(): void {
  const element = panel.value
  if (!element) return
  const { x, y } = props.anchor
  const maxLeft = window.innerWidth - element.offsetWidth - EDGE
  const left = Math.max(EDGE, Math.min(x, maxLeft))
  const below = y + GAP
  if (below + element.offsetHeight <= window.innerHeight - EDGE) {
    position.value = { left, top: below }
    return
  }
  // 下方放不下时放到光标上方（让开光标所在的一行）。
  const above = y - LINE - GAP
  position.value = { left, bottom: Math.max(EDGE, window.innerHeight - Math.max(above, element.offsetHeight + EDGE)) }
}

function reveal(): void {
  list.value?.querySelector(`#${CSS.escape(optionId(active.value))}`)?.scrollIntoView({ block: 'nearest' })
}

onMounted(async () => {
  place()
  input.value?.focus({ preventScroll: true })
  await nextTick()
  reveal()
})

watch(active, () => void nextTick(reveal))

function pick(index: number): void {
  const row = visible.value[index]
  if (!row) return
  lastShow = show.value
  emit('pick', row.id, show.value)
}

function onInputKeydown(event: KeyboardEvent): void {
  const count = visible.value.length
  switch (event.key) {
    case 'ArrowDown':
      if (count > 0) active.value = (active.value + 1) % count
      break
    case 'ArrowUp':
      if (count > 0) active.value = (active.value - 1 + count) % count
      break
    case 'Enter':
      if (event.isComposing) return
      pick(active.value)
      break
    default:
      return
  }
  event.preventDefault()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
  } else if (event.key === 'Enter' && event.target !== input.value && !event.isComposing) {
    // 在显示格式上按 Enter 同样确定当前选中的章节。
    event.preventDefault()
    pick(active.value)
  }
}
</script>

<template>
  <div class="chapter-ref-picker__backdrop" @mousedown.prevent @click="emit('cancel')"></div>
  <div
    ref="panel"
    class="chapter-ref-picker"
    role="dialog"
    aria-label="插入章节引用"
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
      ref="input"
      v-model="query"
      class="chapter-ref-picker__search"
      type="text"
      placeholder="搜索章节"
      role="combobox"
      aria-label="搜索章节"
      aria-autocomplete="list"
      aria-expanded="true"
      :aria-controls="`${id}-list`"
      :aria-activedescendant="visible.length > 0 ? optionId(active) : undefined"
      spellcheck="false"
      autocomplete="off"
      @keydown="onInputKeydown"
    />
    <div :id="`${id}-list`" ref="list" class="chapter-ref-picker__list" role="listbox" aria-label="章节">
      <div
        v-for="(row, index) in visible"
        :id="optionId(index)"
        :key="row.id"
        class="chapter-ref-picker__option"
        :class="{ 'chapter-ref-picker__option--active': index === active }"
        role="option"
        :aria-selected="index === active"
        :style="{ paddingLeft: `calc(var(--space-4) + ${query.trim() === '' ? row.depth : 0} * var(--space-6))` }"
        @mousemove="active = index"
        @mousedown.prevent
        @click="pick(index)"
      >
        <span class="chapter-ref-picker__number">{{ row.number }}</span>
        <span class="chapter-ref-picker__title" :class="{ 'chapter-ref-picker__title--untitled': !row.title }">
          {{ row.title || '未命名章节' }}
        </span>
      </div>
      <p v-if="visible.length === 0" class="chapter-ref-picker__empty">没有匹配的章节</p>
    </div>
    <div class="chapter-ref-picker__footer">
      <SegmentedControl v-model="show" :options="SHOW_OPTIONS" label="显示格式" />
    </div>
  </div>
</template>

<style scoped>
.chapter-ref-picker__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.chapter-ref-picker {
  position: fixed;
  z-index: calc(var(--z-popover) + 1);
  display: flex;
  flex-direction: column;
  width: 340px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  padding: var(--space-2);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-popover);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  animation: chapter-ref-picker-in var(--duration-fast) var(--ease-out);
}

@keyframes chapter-ref-picker-in {
  from {
    opacity: 0;
  }
}

.chapter-ref-picker__search {
  height: var(--control-h-m);
  margin: 0 0 var(--space-2);
  padding: 0 var(--space-4);
  border: none;
  border-bottom: 1px solid var(--color-separator);
  border-radius: 0;
  background: none;
  color: inherit;
  font: inherit;
  outline: none;
}

.chapter-ref-picker__search::placeholder {
  color: var(--color-text-tertiary);
}

.chapter-ref-picker__list {
  max-height: 280px;
  overflow-y: auto;
}

.chapter-ref-picker__option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h-m);
  padding: 0 var(--space-4);
  box-sizing: border-box;
  border-radius: var(--radius-m);
  cursor: default;
}

.chapter-ref-picker__option--active {
  background: var(--color-accent);
  color: var(--color-text-on-accent);
}

.chapter-ref-picker__number {
  flex: none;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.chapter-ref-picker__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chapter-ref-picker__title--untitled {
  color: var(--color-text-tertiary);
}

.chapter-ref-picker__option--active .chapter-ref-picker__number,
.chapter-ref-picker__option--active .chapter-ref-picker__title--untitled {
  color: inherit;
  opacity: 0.75;
}

.chapter-ref-picker__empty {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--color-text-tertiary);
}

.chapter-ref-picker__footer {
  display: flex;
  justify-content: center;
  margin-top: var(--space-2);
  padding: var(--space-3) var(--space-2) var(--space-1);
  border-top: 1px solid var(--color-separator);
}
</style>
