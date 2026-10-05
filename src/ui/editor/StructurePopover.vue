<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { moleculeBySmiles, searchMolecules, type Molecule } from './structure_library.ts'
import { isValidSmiles, renderStructure } from './structure_view.ts'

/**
 * 编辑化学结构式（docs/decisions.md 第 22 节）：在结构式（或插入处）下方弹出。
 *
 * - 输入名称（中文或英文）查找常见分子，或直接输入 SMILES；下方是将要插入的结构式的预览。
 * - 名称的匹配列在输入框下：输入的文字是有效的 SMILES 时默认使用它（↑ 回到它），否则默认第一个匹配。
 *   ↑ / ↓ 选择，Enter 或“完成”完成，点击一个分子直接完成；Esc 或“取消”放弃，点击浮层以外也完成。
 * - 完成时发出 SMILES；没有修改时得到原文，清空即删除。只发出 commit / cancel，正文由编辑器修改。
 */
const props = defineProps<{
  anchor: { readonly x: number; readonly y: number }
  smiles: string
}>()

const emit = defineEmits<{
  commit: [smiles: string]
  cancel: []
}>()

const query = ref(props.smiles)
const matches = computed<readonly Molecule[]>(() => searchMolecules(query.value))
const typedValid = computed(() => isValidSmiles(query.value))
/** 选中的匹配；-1 是输入的文字本身（作为 SMILES）。 */
const active = ref(-1)
watch(query, () => (active.value = typedValid.value || matches.value.length === 0 ? -1 : 0), { immediate: true })

/** 完成时得到的 SMILES 与它的名称（库中有时）。 */
const target = computed(() => {
  const molecule = active.value >= 0 ? matches.value[active.value] : null
  const smiles = molecule ? molecule.smiles : query.value.trim()
  return { smiles, name: (molecule ?? moleculeBySmiles(smiles))?.names[0] ?? null }
})

const id = useId()
const optionId = (index: number) => `${id}-option-${index}`
const panel = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
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
  if (target.value.smiles === '') {
    preview.value.replaceChildren()
    preview.value.classList.remove('is-invalid')
    return
  }
  renderStructure(preview.value, target.value.smiles)
}

watch(() => target.value.smiles, showPreview)

function commit(): void {
  const smiles = target.value.smiles
  emit('commit', smiles === props.smiles.trim() ? props.smiles : smiles)
}

function pick(index: number): void {
  active.value = index
  commit()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  const first = typedValid.value || matches.value.length === 0 ? -1 : 0
  const last = matches.value.length - 1
  if (event.key === 'ArrowDown' && last >= 0) active.value = active.value >= last ? first : active.value + 1
  else if (event.key === 'ArrowUp' && last >= 0) active.value = active.value <= first ? last : active.value - 1
  else if (event.key === 'Enter') commit()
  else if (event.key === 'Escape') {
    event.stopPropagation()
    emit('cancel')
  } else return
  event.preventDefault()
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
  <div class="structure-popover__backdrop" @mousedown.prevent="commit"></div>
  <div
    ref="panel"
    class="structure-popover"
    role="dialog"
    aria-label="化学结构式"
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
    <div class="structure-popover__label">化学结构式</div>
    <input
      ref="input"
      v-model="query"
      class="structure-popover__search"
      type="text"
      placeholder="名称或 SMILES，如 苯、乙醇、CCO"
      role="combobox"
      aria-label="名称或 SMILES"
      aria-autocomplete="list"
      :aria-expanded="matches.length > 0"
      :aria-controls="`${id}-list`"
      :aria-activedescendant="active >= 0 ? optionId(active) : undefined"
      spellcheck="false"
      autocomplete="off"
      @keydown="onKeydown"
    />
    <div v-if="matches.length > 0" :id="`${id}-list`" class="structure-popover__list" role="listbox" aria-label="常见分子">
      <div
        v-for="(molecule, index) in matches"
        :id="optionId(index)"
        :key="molecule.smiles"
        class="structure-popover__option"
        :class="{ 'structure-popover__option--active': index === active }"
        role="option"
        :aria-selected="index === active"
        @mousemove="active = index"
        @mousedown.prevent
        @click="pick(index)"
      >
        <span class="structure-popover__name">{{ molecule.names[0] }}</span>
        <span class="structure-popover__english">{{ molecule.english }}</span>
      </div>
    </div>
    <div ref="preview" class="structure-popover__preview" aria-live="polite"></div>
    <div class="structure-popover__footer">
      <span class="structure-popover__smiles" :title="target.smiles">
        <template v-if="target.name">{{ target.name }} · </template>{{ target.smiles }}
      </span>
      <div class="structure-popover__actions">
        <button type="button" class="structure-popover__action" @mousedown.prevent @click="emit('cancel')">
          <span class="structure-popover__key">⎋</span>取消
        </button>
        <button type="button" class="structure-popover__action is-default" @mousedown.prevent @click="commit">
          <span class="structure-popover__key">↩</span>完成
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.structure-popover__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

/* 与公式浮层相同的外观。 */
.structure-popover {
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
  animation: structure-popover-in var(--duration-fast) var(--ease-out);
}

@keyframes structure-popover-in {
  from {
    opacity: 0;
  }
}

.structure-popover__label {
  margin-bottom: var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  -webkit-user-select: none;
  user-select: none;
}

.structure-popover__search {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: var(--space-2) 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  outline: none;
}

.structure-popover__search::placeholder {
  color: var(--color-text-tertiary);
}

/* 匹配的分子：与文献引用浮层相同的选中样式。 */
.structure-popover__list {
  max-height: 200px;
  margin: var(--space-1) calc(-1 * var(--space-3)) 0;
  overflow-y: auto;
}

.structure-popover__option {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-m);
  cursor: default;
}

.structure-popover__option--active {
  background: var(--color-accent);
  color: var(--color-text-on-accent);
}

.structure-popover__english {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.structure-popover__option--active .structure-popover__english {
  color: inherit;
  opacity: 0.75;
}

/* 预览：与公式浮层的预览相同的底色，结构式随正文颜色，过大时滚动。 */
.structure-popover__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 72px;
  max-height: 260px;
  margin-top: var(--space-3);
  padding: var(--space-4);
  overflow: auto;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  color: var(--color-doc-text);
}

.structure-popover__preview.is-invalid {
  color: var(--color-danger-text);
  font-family: var(--font-mono);
  font-size: var(--text-s);
}

.structure-popover__preview :deep(svg) {
  flex: none;
}

.structure-popover__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-separator);
}

.structure-popover__smiles {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
  -webkit-user-select: none;
  user-select: none;
}

.structure-popover__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
  margin-right: calc(-1 * var(--space-3));
}

.structure-popover__action {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-s);
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  cursor: default;
}

.structure-popover__action.is-default {
  color: var(--color-accent-text);
}

.structure-popover__action:hover {
  background: var(--color-fill-hover);
}

.structure-popover__action:active {
  background: var(--color-fill-pressed);
}

.structure-popover__action:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
}

.structure-popover__key {
  color: var(--color-text-tertiary);
}
</style>
