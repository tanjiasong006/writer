<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SnapshotInfo } from '../../application/project_storage.ts'

/**
 * 版本历史（docs/project-format.md 第 7.1 节）：项目在某一时刻的完整内容。
 *
 * - 上方“保存当前版本”，可以命名；下方是全部版本（最新的在前）：时间、名称或来源、章节数与字数。
 * - 选中一个版本后可以“恢复此版本…”（先确认，恢复前自动留下当前版本）或删除。
 * - 每天第一次打开文档时自动留下一个版本，自动版本最多保留 30 个。
 * - 只发出事件，读写由工作区完成；Esc 与“完成”关闭。
 */
const props = defineProps<{
  snapshots: readonly SnapshotInfo[] | null
  /** 正在保存、恢复或删除。 */
  busy?: boolean
}>()

const emit = defineEmits<{
  create: [label: string]
  restore: [snapshot: SnapshotInfo]
  delete: [snapshot: SnapshotInfo]
  close: []
}>()

const label = ref('')
const selected = ref<string | null>(null)
const current = computed(() => props.snapshots?.find((snapshot) => snapshot.id === selected.value) ?? null)
const dialog = ref<HTMLElement | null>(null)

const KIND_LABELS = { manual: '手动保存', auto: '自动保存', 'before-restore': '恢复前的版本' } as const

function time(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function create(): void {
  if (props.busy) return
  emit('create', label.value.trim())
  label.value = ''
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('input, button:not(:disabled), [tabindex="0"]') ?? [])]
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
  dialog.value?.querySelector<HTMLInputElement>('.history__label')?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <div class="history__scrim">
    <div ref="dialog" class="history" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <h2 id="history-title" class="history__title">版本历史</h2>
      <form class="history__create" @submit.prevent="create">
        <input
          v-model="label"
          class="history__label history__input"
          type="text"
          placeholder="为当前版本命名（可选）"
          aria-label="版本名称"
          spellcheck="false"
          autocomplete="off"
        />
        <button type="submit" class="history__button" :disabled="busy">保存当前版本</button>
      </form>
      <ul class="history__list" role="listbox" aria-label="版本">
        <li v-if="snapshots === null" class="history__empty">正在读取…</li>
        <li v-else-if="snapshots.length === 0" class="history__empty">还没有保存过版本。</li>
        <li
          v-for="snapshot in snapshots ?? []"
          :key="snapshot.id"
          class="history__item"
          :class="{ 'history__item--selected': snapshot.id === selected }"
          role="option"
          :aria-selected="snapshot.id === selected"
          tabindex="0"
          @click="selected = snapshot.id"
          @keydown.enter.prevent="selected = snapshot.id"
        >
          <span class="history__name">{{ snapshot.label || KIND_LABELS[snapshot.kind] }}</span>
          <span class="history__meta">
            {{ time(snapshot.createdAt) }}　{{ snapshot.chapters }} 章 · {{ snapshot.characters.toLocaleString('zh-CN') }} 字
            <template v-if="snapshot.label">　{{ KIND_LABELS[snapshot.kind] }}</template>
          </span>
        </li>
      </ul>
      <div class="history__actions">
        <button type="button" class="history__button" :disabled="!current || busy" @click="current && emit('delete', current)">删除</button>
        <button type="button" class="history__button" :disabled="!current || busy" @click="current && emit('restore', current)">恢复此版本…</button>
        <span class="history__spacer"></span>
        <button type="button" class="history__button history__button--primary" @click="emit('close')">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 与其他对话框相同的模态对话框。 */
.history__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14vh;
  background: var(--color-scrim);
  animation: history-fade var(--duration-base) var(--ease-out);
}

@keyframes history-fade {
  from {
    opacity: 0;
  }
}

.history {
  display: flex;
  flex-direction: column;
  width: 480px;
  max-width: calc(100vw - 2 * var(--space-8));
  max-height: 72vh;
  box-sizing: border-box;
  padding: var(--space-7) var(--space-7) var(--space-6);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-dialog);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
}

.history__title {
  margin: 0 0 var(--space-6);
  font-size: var(--text-l);
  font-weight: var(--weight-semibold);
}

.history__create {
  display: flex;
  gap: var(--space-4);
  margin: 0 0 var(--space-5);
}

.history__input {
  flex: 1;
  min-width: 0;
  height: var(--control-h-m);
  box-sizing: border-box;
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

.history__input::placeholder {
  color: var(--color-text-tertiary);
}

.history__input:focus {
  box-shadow: 0 0 0 1px var(--color-accent), 0 0 0 3px var(--color-accent-fill-strong);
}

.history__list {
  flex: 1;
  min-height: 160px;
  margin: 0;
  padding: var(--space-1);
  overflow-y: auto;
  border-radius: var(--radius-m);
  box-shadow: inset 0 0 0 1px var(--color-separator);
  list-style: none;
}

.history__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-s);
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
}

.history__item:hover {
  background: var(--color-fill-hover);
}

.history__item--selected,
.history__item--selected:hover {
  background: var(--color-accent-fill-strong);
}

.history__item:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}

.history__name {
  font-weight: var(--weight-medium);
}

.history__meta {
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  font-variant-numeric: tabular-nums;
}

.history__empty {
  padding: var(--space-6) var(--space-4);
  color: var(--color-text-tertiary);
  text-align: center;
}

.history__actions {
  display: flex;
  gap: var(--space-4);
  margin-top: var(--space-6);
}

.history__spacer {
  flex: 1;
}

.history__button {
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
  white-space: nowrap;
}

.history__button:hover:not(:disabled) {
  background: var(--color-fill-pressed);
}

.history__button:disabled {
  color: var(--color-text-disabled);
}

.history__button:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.history__button--primary {
  background: var(--color-accent);
  box-shadow: none;
  color: var(--color-text-on-accent);
}

.history__button--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}
</style>
