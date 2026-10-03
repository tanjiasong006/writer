<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  emptyReference,
  formatReference,
  newReferenceId,
  type ReferenceEntry,
  type ReferenceField,
  type ReferenceType,
} from '../../domain/bibliography/bibliography.ts'

/**
 * 参考文献对话框（docs/decisions.md 第 13 节）：管理文档的文献条目。
 *
 * - 左侧是条目列表（著录文字，已被引用的显示编号），右侧编辑选中的条目：类型与按类型列出的字段，
 *   下方是按 GB/T 7714 生成的著录文字预览。
 * - “新建文献”添加空条目并选中；“删除”删除选中的条目（被引用的先确认，引用随之失效）。
 * - 修改在对话框中进行，“完成”时一次提交（submit），“取消”或 Esc 放弃；不进入正文撤销历史。
 */
const props = defineProps<{
  references: readonly ReferenceEntry[]
  /** 已被引用的文献的编号。 */
  numbers: ReadonlyMap<string, number>
  /** 打开时选中的条目（如从引用打开）。 */
  initial?: string | null
  /** 删除被引用的文献前的确认（返回 true 删除）。 */
  confirmDelete: (count: number) => Promise<boolean>
  /** 文献被引用的次数。 */
  citationCount: (id: string) => number
}>()

const emit = defineEmits<{
  submit: [references: ReferenceEntry[]]
  cancel: []
}>()

const entries = shallowRef<ReferenceEntry[]>([...props.references])
const selected = ref<string | null>(props.initial ?? props.references[0]?.id ?? null)
const current = computed(() => entries.value.find((entry) => entry.id === selected.value) ?? null)
const dialog = ref<HTMLElement | null>(null)

const TYPES: ReadonlyArray<{ readonly value: ReferenceType; readonly label: string }> = [
  { value: 'book', label: '专著' },
  { value: 'article', label: '期刊文章' },
  { value: 'chapter', label: '书中章节' },
  { value: 'thesis', label: '学位论文' },
  { value: 'report', label: '报告' },
  { value: 'web', label: '网页' },
  { value: 'other', label: '其他' },
]

/** 各类型需要的字段与名称（作者、题名、年份在前，网址与 DOI 在后，所有类型都有）。 */
const FIELDS: Readonly<Record<ReferenceType, ReadonlyArray<readonly [ReferenceField, string]>>> = {
  book: [['place', '出版地'], ['publisher', '出版者'], ['pages', '页码']],
  article: [['container', '刊名'], ['volume', '卷'], ['issue', '期'], ['pages', '页码']],
  chapter: [['container', '书名'], ['place', '出版地'], ['publisher', '出版者'], ['pages', '页码']],
  thesis: [['place', '学校所在地'], ['publisher', '学校']],
  report: [['place', '出版地'], ['publisher', '发布机构']],
  web: [['container', '网站']],
  other: [['publisher', '出版者']],
}

const fields = computed<ReadonlyArray<readonly [ReferenceField, string]>>(() => {
  const type = current.value?.type ?? 'book'
  return [['author', '作者'], ['title', '题名'], ...FIELDS[type], ['year', '年份'], ['url', '网址'], ['doi', 'DOI']]
})

function update(patch: Partial<ReferenceEntry>): void {
  const id = selected.value
  entries.value = entries.value.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
}

async function add(): Promise<void> {
  const entry = emptyReference(newReferenceId(entries.value))
  entries.value = [...entries.value, entry]
  selected.value = entry.id
  await nextTick()
  dialog.value?.querySelector<HTMLInputElement>('#reference-field-author')?.focus()
}

async function remove(): Promise<void> {
  const id = selected.value
  if (id === null) return
  const count = props.citationCount(id)
  if (count > 0 && !(await props.confirmDelete(count))) return
  const index = entries.value.findIndex((entry) => entry.id === id)
  entries.value = entries.value.filter((entry) => entry.id !== id)
  selected.value = entries.value[Math.min(index, entries.value.length - 1)]?.id ?? null
}

function submit(): void {
  emit('submit', entries.value)
}

function label(entry: ReferenceEntry): string {
  const text = formatReference(entry)
  return text === '（无题名）[M].' && entry.title === '' && entry.author === '' ? '新文献' : text
}

/** Esc 取消；Tab 只在对话框内循环（与其他对话框相同）。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
    return
  }
  if (event.key !== 'Tab') return
  const controls = [
    ...(dialog.value?.querySelectorAll<HTMLElement>('[tabindex="0"], input, select, button:not(:disabled)') ?? []),
  ]
  if (controls.length === 0) return
  event.preventDefault()
  event.stopPropagation()
  const index = controls.indexOf(document.activeElement as HTMLElement)
  const next = index === -1 ? 0 : index + (event.shiftKey ? -1 : 1)
  controls[(next + controls.length) % controls.length].focus()
}

let previousFocus: HTMLElement | null = null

onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', onKeydown, true)
  await nextTick()
  dialog.value?.querySelector<HTMLElement>(current.value ? '#reference-field-author' : '.references__add')?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <div class="references__scrim">
    <form ref="dialog" class="references" role="dialog" aria-modal="true" aria-labelledby="references-title" @submit.prevent="submit">
      <h2 id="references-title" class="references__title">参考文献</h2>
      <div class="references__body">
        <div class="references__side">
          <ul class="references__list" role="listbox" aria-label="文献">
            <li
              v-for="entry in entries"
              :key="entry.id"
              class="references__item"
              :class="{ 'references__item--selected': entry.id === selected }"
              role="option"
              :aria-selected="entry.id === selected"
              tabindex="0"
              @click="selected = entry.id"
              @keydown.enter.prevent="selected = entry.id"
            >
              <span class="references__number">{{ numbers.has(entry.id) ? `[${numbers.get(entry.id)}]` : '' }}</span>
              <span class="references__text">{{ label(entry) }}</span>
            </li>
            <li v-if="entries.length === 0" class="references__empty">还没有文献。</li>
          </ul>
          <div class="references__side-actions">
            <button type="button" class="references__button references__add" @click="add">新建文献</button>
            <button type="button" class="references__button" :disabled="current === null" @click="remove">删除</button>
          </div>
        </div>
        <div v-if="current" class="references__form">
          <label class="references__label" for="reference-type">类型</label>
          <select
            id="reference-type"
            class="references__input"
            :value="current.type"
            @change="update({ type: ($event.target as HTMLSelectElement).value as ReferenceType })"
          >
            <option v-for="type in TYPES" :key="type.value" :value="type.value">{{ type.label }}</option>
          </select>
          <template v-for="[field, name] in fields" :key="field">
            <label class="references__label" :for="`reference-field-${field}`">{{ name }}</label>
            <input
              :id="`reference-field-${field}`"
              class="references__input"
              type="text"
              :value="current[field]"
              :placeholder="field === 'author' ? '多位作者以分号分隔' : ''"
              spellcheck="false"
              autocomplete="off"
              @input="update({ [field]: ($event.target as HTMLInputElement).value })"
            />
          </template>
          <p class="references__preview">{{ formatReference(current) }}</p>
        </div>
        <p v-else class="references__form references__form--empty">选择或新建一条文献。</p>
      </div>
      <div class="references__actions">
        <button type="button" class="references__button" @click="emit('cancel')">取消</button>
        <button type="submit" class="references__button references__button--primary">完成</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
/* 与文档信息对话框相同的模态对话框，宽一些以容纳列表与表单。 */
.references__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  background: var(--color-scrim);
  animation: references-fade var(--duration-base) var(--ease-out);
}

@keyframes references-fade {
  from {
    opacity: 0;
  }
}

.references {
  display: flex;
  flex-direction: column;
  width: 760px;
  max-width: calc(100vw - 2 * var(--space-8));
  max-height: 80vh;
  box-sizing: border-box;
  margin: 0;
  padding: var(--space-7) var(--space-7) var(--space-6);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-dialog);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
}

.references__title {
  margin: 0 0 var(--space-6);
  font-size: var(--text-l);
  font-weight: var(--weight-semibold);
}

.references__body {
  display: flex;
  flex: 1;
  gap: var(--space-7);
  min-height: 0;
}

.references__side {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 280px;
  min-height: 0;
}

.references__list {
  flex: 1;
  min-height: 160px;
  margin: 0;
  padding: var(--space-1);
  overflow-y: auto;
  border-radius: var(--radius-m);
  box-shadow: inset 0 0 0 1px var(--color-separator);
  list-style: none;
}

.references__item {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-s);
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
}

.references__item:hover {
  background: var(--color-fill-hover);
}

.references__item--selected,
.references__item--selected:hover {
  background: var(--color-accent-fill-strong);
}

.references__item:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}

.references__number {
  flex: none;
  min-width: 2em;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.references__text {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: var(--text-s);
  line-height: var(--leading-tight);
}

.references__empty {
  padding: var(--space-5) var(--space-4);
  color: var(--color-text-tertiary);
}

.references__side-actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

/* 表单：标签右对齐成一列（与文档信息相同）。 */
.references__form {
  display: grid;
  flex: 1;
  grid-template-columns: auto 1fr;
  align-content: start;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  overflow-y: auto;
}

.references__form--empty {
  display: block;
  margin: 0;
  padding-top: var(--space-6);
  color: var(--color-text-tertiary);
  text-align: center;
}

.references__label {
  color: var(--color-text-secondary);
  text-align: right;
  white-space: nowrap;
  -webkit-user-select: none;
  user-select: none;
}

.references__input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: var(--control-h-m);
  margin: 0;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-bg);
  box-shadow: inset 0 0 0 1px var(--color-separator);
  color: var(--color-text);
  font: inherit;
  outline: none;
}

.references__input::placeholder {
  color: var(--color-text-tertiary);
}

.references__input:focus {
  box-shadow: 0 0 0 1px var(--color-accent), 0 0 0 3px var(--color-accent-fill-strong);
}

.references__preview {
  grid-column: 1 / -1;
  margin: var(--space-2) 0 0;
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.references__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-4);
  margin-top: var(--space-7);
}

.references__button {
  min-width: 72px;
  height: var(--control-h-m);
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  box-shadow: inset 0 0 0 1px var(--color-separator);
  color: var(--color-text);
  font: inherit;
  font-weight: var(--weight-medium);
}

.references__button:hover:not(:disabled) {
  background: var(--color-fill-pressed);
}

.references__button:disabled {
  color: var(--color-text-disabled);
}

.references__button:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.references__button--primary {
  background: var(--color-accent);
  box-shadow: none;
  color: var(--color-text-on-accent);
}

.references__button--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}
</style>
