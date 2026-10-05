<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { moleculeByName, moleculeBySmiles, searchMolecules, sideSmiles, sideText, splitTerms, type Molecule } from './structure_library.ts'
import { isValidSmiles, renderStructure } from './structure_view.ts'
import { normalizeArrow, type StructureConditions } from './markdown.ts'

/**
 * 编辑化学结构式（docs/decisions.md 第 22 节）：在结构式（或插入处）下方弹出，分“分子”与“反应式”两种。
 *
 * - 分子：输入名称（中文或英文）查找常见分子，或直接输入 SMILES。输入的文字是有效的 SMILES 时默认使用它（↑ 回到它），
 *   否则默认第一个匹配；↑ / ↓ 选择，点击一个分子直接完成。
 * - 反应式：反应物与产物写分子的名称或 SMILES，以“+”分隔；正在输入的名称下方列出匹配，↑ / ↓ 选择、Enter 填入。
 *   箭头（→ ⇌ ＝）与箭头上下的条件。SMILES 中原有的试剂保留（显示在箭头上方）。
 * - Enter 或“完成”完成，Esc 或“取消”放弃，点击浮层以外也完成；下方是预览。没有修改时得到原值，清空即删除。
 * - 只发出 commit / cancel，正文由编辑器修改。
 */
export interface StructureValue extends StructureConditions {
  readonly smiles: string
}

const props = defineProps<{
  anchor: { readonly x: number; readonly y: number }
  smiles: string
  arrow?: string
  above?: string
  below?: string
}>()

const emit = defineEmits<{
  commit: [value: StructureValue]
  cancel: []
}>()

const ARROWS = [
  { value: '', label: '生成', glyph: '→' },
  { value: '<=>', label: '可逆', glyph: '⇌' },
  { value: '=', label: '等号', glyph: '＝' },
] as const

const initial: StructureValue = {
  smiles: props.smiles,
  arrow: normalizeArrow(props.arrow ?? ''),
  above: props.above ?? '',
  below: props.below ?? '',
}
const initialParts = initial.smiles.split('>')
const isReaction = initialParts.length === 3

const mode = ref<'molecule' | 'reaction'>(isReaction ? 'reaction' : 'molecule')

// 分子
const query = ref(isReaction ? '' : initial.smiles)
const matches = computed<readonly Molecule[]>(() => searchMolecules(query.value))
const typedValid = computed(() => isValidSmiles(query.value))
/** 选中的匹配；-1 是输入的文字本身（作为 SMILES）。 */
const active = ref(-1)
watch(query, () => (active.value = typedValid.value || matches.value.length === 0 ? -1 : 0), { immediate: true })

// 反应式
const reactants = ref(isReaction ? sideText(initialParts[0]) : '')
const reagents = isReaction ? initialParts[1].trim() : ''
const products = ref(isReaction ? sideText(initialParts[2]) : '')
const arrow = ref(initial.arrow)
const above = ref(initial.above)
const below = ref(initial.below)

/** 正在输入的一侧：它最后一项是名称的一部分时列出匹配。 */
const focusedSide = ref<'reactants' | 'products' | null>(null)
const sideRef = (side: 'reactants' | 'products') => (side === 'reactants' ? reactants : products)
const suggestions = computed<readonly Molecule[]>(() => {
  if (focusedSide.value === null) return []
  const text = sideRef(focusedSide.value).value
  const term = /[+＋]\s*$/.test(text) ? '' : (splitTerms(text).at(-1) ?? '')
  if (term === '' || moleculeByName(term) || isValidSmiles(term)) return []
  return searchMolecules(term).slice(0, 5)
})
const suggestion = ref(0)
watch(suggestions, () => (suggestion.value = 0))

/** 反应式中不认识的项（既不是库中的名称，也不是有效的 SMILES）。 */
const unknownTerms = computed(() =>
  mode.value === 'reaction'
    ? [...splitTerms(reactants.value), ...splitTerms(products.value)].filter((term) => !moleculeByName(term) && !isValidSmiles(term))
    : [],
)

/** 完成时得到的结构式。 */
const target = computed<StructureValue & { readonly name: string | null }>(() => {
  if (mode.value === 'molecule') {
    const molecule = active.value >= 0 ? matches.value[active.value] : null
    const smiles = molecule ? molecule.smiles : query.value.trim()
    return { smiles, arrow: '', above: '', below: '', name: (molecule ?? moleculeBySmiles(smiles))?.names[0] ?? null }
  }
  const left = sideSmiles(reactants.value)
  const right = sideSmiles(products.value)
  const smiles = left === '' && right === '' ? '' : `${left}>${reagents}>${right}`
  return { smiles, arrow: arrow.value, above: above.value.trim(), below: below.value.trim(), name: null }
})

const id = useId()
const optionId = (index: number) => `${id}-option-${index}`
const panel = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const reactantsInput = ref<HTMLInputElement | null>(null)
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
  const element = preview.value
  if (!element) return
  if (unknownTerms.value.length > 0) {
    element.replaceChildren()
    element.textContent = `不认识：${unknownTerms.value.join('、')}（请使用分子库中的名称或 SMILES）`
    element.classList.add('is-invalid')
    return
  }
  if (target.value.smiles === '') {
    element.replaceChildren()
    element.classList.remove('is-invalid')
    return
  }
  renderStructure(element, target.value.smiles, target.value)
}

watch(() => [target.value.smiles, target.value.arrow, target.value.above, target.value.below, unknownTerms.value.join()], showPreview)

function commit(): void {
  const { smiles, arrow, above, below } = target.value
  const unchanged = smiles === initial.smiles.trim() && arrow === initial.arrow && above === initial.above.trim() && below === initial.below.trim()
  emit('commit', unchanged ? initial : { smiles, arrow, above, below })
}

function pick(index: number): void {
  active.value = index
  commit()
}

/** 把正在输入的一侧的最后一项换成匹配的分子名称。 */
function fill(side: 'reactants' | 'products', molecule: Molecule): void {
  const field = sideRef(side)
  const terms = splitTerms(field.value)
  terms[terms.length - 1] = molecule.names[0]
  field.value = terms.join(' + ')
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

function onSideKeydown(event: KeyboardEvent, side: 'reactants' | 'products'): void {
  if (event.isComposing) return
  const count = suggestions.value.length
  if (event.key === 'ArrowDown' && count > 0) suggestion.value = (suggestion.value + 1) % count
  else if (event.key === 'ArrowUp' && count > 0) suggestion.value = (suggestion.value - 1 + count) % count
  else if (event.key === 'Enter' && count > 0) fill(side, suggestions.value[suggestion.value])
  else onFieldKeydown(event)
  if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) && count > 0) event.preventDefault()
}

/** 反应式的其他输入框：Enter 完成，Esc 放弃。 */
function onFieldKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Enter') commit()
  else if (event.key === 'Escape') {
    event.stopPropagation()
    emit('cancel')
  } else return
  event.preventDefault()
}

async function focusMode(): Promise<void> {
  await nextTick()
  const field = mode.value === 'molecule' ? input.value : reactantsInput.value
  field?.focus({ preventScroll: true })
  field?.select()
}

async function setMode(next: 'molecule' | 'reaction'): Promise<void> {
  if (mode.value === next) return
  // 从分子切换到反应式时，已输入的分子作为第一个反应物。
  if (next === 'reaction' && reactants.value === '' && target.value.smiles !== '') reactants.value = sideText(target.value.smiles)
  mode.value = next
  await nextTick()
  showPreview()
  place()
  await focusMode()
}

onMounted(async () => {
  showPreview()
  place()
  await focusMode()
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
    <div class="structure-popover__modes" role="tablist" aria-label="化学结构式">
      <button
        v-for="item in [{ value: 'molecule', label: '分子' }, { value: 'reaction', label: '反应式' }] as const"
        :key="item.value"
        type="button"
        role="tab"
        class="structure-popover__mode"
        :aria-selected="mode === item.value"
        tabindex="-1"
        @mousedown.prevent
        @click="setMode(item.value)"
      >
        {{ item.label }}
      </button>
    </div>

    <template v-if="mode === 'molecule'">
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
    </template>

    <div v-else class="structure-popover__fields">
      <template v-for="side in ['reactants', 'products'] as const" :key="side">
        <label class="structure-popover__field-label" :class="{ 'is-products': side === 'products' }" :for="`${id}-${side}`">
          {{ side === 'reactants' ? '反应物' : '产物' }}
        </label>
        <input
          :id="`${id}-${side}`"
          :ref="side === 'reactants' ? (element) => (reactantsInput = element as HTMLInputElement | null) : undefined"
          v-model="sideRef(side).value"
          class="structure-popover__input"
          :class="{ 'is-products': side === 'products' }"
          type="text"
          :placeholder="side === 'reactants' ? '如 乙醇 + 乙酸' : '如 乙酸乙酯 + 水'"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="focusedSide === side && suggestions.length > 0"
          spellcheck="false"
          autocomplete="off"
          @focus="focusedSide = side"
          @blur="focusedSide = null"
          @keydown="onSideKeydown($event, side)"
        />
        <div
          v-if="focusedSide === side && suggestions.length > 0"
          class="structure-popover__suggestions"
          :class="{ 'is-products': side === 'products' }"
          role="listbox"
          aria-label="常见分子"
        >
          <div
            v-for="(molecule, index) in suggestions"
            :key="molecule.smiles"
            class="structure-popover__option"
            :class="{ 'structure-popover__option--active': index === suggestion }"
            role="option"
            :aria-selected="index === suggestion"
            @mousemove="suggestion = index"
            @mousedown.prevent
            @click="fill(side, molecule)"
          >
            <span class="structure-popover__name">{{ molecule.names[0] }}</span>
            <span class="structure-popover__english">{{ molecule.english }}</span>
          </div>
        </div>
      </template>

      <span class="structure-popover__field-label structure-popover__arrow-label">条件</span>
      <div class="structure-popover__arrow-row">
        <div class="structure-popover__arrows" role="radiogroup" aria-label="箭头">
          <button
            v-for="item in ARROWS"
            :key="item.value"
            type="button"
            role="radio"
            class="structure-popover__arrow"
            :aria-checked="arrow === item.value"
            :aria-label="item.label"
            :title="item.label"
            tabindex="-1"
            @mousedown.prevent
            @click="arrow = item.value"
          >
            {{ item.glyph }}
          </button>
        </div>
        <label class="structure-popover__condition">
          <span class="structure-popover__condition-label">上</span>
          <input
            v-model="above"
            class="structure-popover__input"
            type="text"
            placeholder="如 浓硫酸"
            aria-label="上方条件"
            spellcheck="false"
            autocomplete="off"
            @keydown="onFieldKeydown"
          />
        </label>
        <label class="structure-popover__condition">
          <span class="structure-popover__condition-label">下</span>
          <input
            v-model="below"
            class="structure-popover__input"
            type="text"
            placeholder="如 △"
            aria-label="下方条件"
            spellcheck="false"
            autocomplete="off"
            @keydown="onFieldKeydown"
          />
        </label>
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
  width: 460px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  padding: var(--space-3) var(--space-5) var(--space-3);
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

/* 分子 / 反应式：与公式浮层标题同样安静的文字，选中的一个是正文颜色。 */
.structure-popover__modes {
  display: flex;
  gap: var(--space-1);
  margin: 0 calc(-1 * var(--space-2)) var(--space-1);
}

.structure-popover__mode {
  height: var(--control-h-s);
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--color-text-tertiary);
  font-family: var(--font-ui);
  font-size: var(--text-s);
  cursor: default;
}

.structure-popover__mode:hover {
  color: var(--color-text-secondary);
}

.structure-popover__mode[aria-selected='true'] {
  color: var(--color-text);
  font-weight: 600;
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

.structure-popover__search::placeholder,
.structure-popover__input::placeholder {
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

/* 反应式：左侧是标签，右侧是输入框；产物在箭头之后（与反应式的顺序相同）。 */
.structure-popover__fields {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2) var(--space-3);
  align-items: center;
  margin-top: var(--space-1);
}

.structure-popover__field-label {
  grid-column: 1;
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  -webkit-user-select: none;
  user-select: none;
}

.structure-popover__field-label.is-products,
.structure-popover__input.is-products,
.structure-popover__suggestions.is-products {
  order: 2;
}

.structure-popover__arrow-label {
  order: 1;
}

.structure-popover__input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: var(--control-h-m);
  margin: 0;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-s);
  background: var(--color-fill-hover);
  color: inherit;
  font: inherit;
  outline: none;
}

.structure-popover__input:focus {
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.structure-popover__suggestions {
  grid-column: 2;
  margin: calc(-1 * var(--space-1)) calc(-1 * var(--space-3)) 0;
}

.structure-popover__arrow-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
  align-items: center;
  order: 1;
}

.structure-popover__condition {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.structure-popover__condition-label {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  -webkit-user-select: none;
  user-select: none;
}

.structure-popover__arrows {
  display: flex;
  gap: 1px;
}

.structure-popover__arrow {
  width: var(--control-h-m);
  height: var(--control-h-m);
  padding: 0;
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--text-l);
  line-height: 1;
  cursor: default;
}

.structure-popover__arrow:hover {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.structure-popover__arrow[aria-checked='true'] {
  background: var(--color-accent-fill);
  color: var(--color-accent-text);
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
  font-family: var(--font-ui);
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

.structure-popover__action:hover,
.structure-popover__mode:hover {
  background: var(--color-fill-hover);
}

.structure-popover__action:active {
  background: var(--color-fill-pressed);
}

.structure-popover__action:focus-visible,
.structure-popover__mode:focus-visible,
.structure-popover__arrow:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
}

.structure-popover__key {
  color: var(--color-text-tertiary);
}
</style>
