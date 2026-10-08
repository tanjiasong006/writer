<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import {
  loadExtendedMolecules,
  moleculeByName,
  moleculeBySmiles,
  searchMolecules,
  sideSmiles,
  sideText,
  smilesText,
  splitTerms,
  usedMolecules,
  type Molecule,
} from './structure_library.ts'
import { isValidSmiles, renderStructure, smilesProblem } from './structure_view.ts'
import { normalizeArrow, normalizeRotate, type StructureConditions } from './markdown.ts'

/**
 * 编辑化学结构式（docs/decisions.md 第 22 节）：在结构式（或插入处）下方弹出，分“分子”与“反应式”两种。
 *
 * - 分子：输入名称（中文、拼音首字母或英文）在分子库中查找，或直接输入 SMILES。扩展库在打开时加载，加载后重新查找；
 *   扩展库中的分子在列表中标“扩展”。输入的文字是有效的 SMILES 时默认使用它（↑ 回到它），
 *   否则默认第一个匹配；↑ / ↓ 选择，点击一个分子直接完成。没有输入时列出本文档中用过的分子（不默认选中）。
 *   选中的一行末尾的“编辑 SMILES”（或 Tab）把它的 SMILES 填入输入框，在它的基础上修改。
 * - 版面不随输入跳动：列表出现后高度固定（插入新结构式时一开始就有），预览高度固定、过大的结构式缩小显示；
 *   反应式中的匹配浮在下方的内容之上。
 * - 反应式：反应物与产物写分子的名称或 SMILES，以“+”分隔；正在输入的名称下方列出匹配（一侧为空或刚输入“+”时列出
 *   本文档中用过的分子），↑ / ↓ 选择、Enter 填入。
 *   箭头（→ ⇌ ＝）与箭头上下的条件。SMILES 中原有的试剂保留（显示在箭头上方）。
 * - 分子可以旋转（每次 30°）与左右翻转：预览右上角的按钮，翻转的是看到的样子。反应式不旋转。
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
  rotate?: number
  flip?: boolean
  /** 本文档中的结构式（SMILES，当前章节在前），列出其中用过的分子。 */
  used?: readonly string[]
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

/** 旋转按钮每次转的度数（与 smiles-drawer 摆正分子时取整的角度相同）。 */
const ROTATE_STEP = 30

const initial: StructureValue = {
  smiles: props.smiles,
  arrow: normalizeArrow(props.arrow ?? ''),
  above: props.above ?? '',
  below: props.below ?? '',
  rotate: normalizeRotate(props.rotate ?? 0),
  flip: props.flip ?? false,
}
const initialParts = initial.smiles.split('>')
const isReaction = initialParts.length === 3

const mode = ref<'molecule' | 'reaction'>(isReaction ? 'reaction' : 'molecule')

/** 列出的用过的分子数上限（与库中查找的结果数相同）。 */
const MAX_USED = 8
/** 扩展库加载完成时加一：分子库不是响应式的，查找结果依赖它以便加载后重新查找。 */
const libraryVersion = ref(0)
const used = computed(() => {
  void libraryVersion.value
  return usedMolecules(props.used ?? [])
})

// 分子
const query = ref(isReaction ? '' : initial.smiles)
/** 没有输入：列出的是本文档中用过的分子。 */
const listingUsed = computed(() => query.value.trim() === '')
const matches = computed<readonly Molecule[]>(() => {
  void libraryVersion.value
  return listingUsed.value ? used.value.slice(0, MAX_USED) : searchMolecules(query.value)
})
const typedValid = computed(() => isValidSmiles(smilesText(query.value)))
/** 选中的匹配；-1 是输入的文字本身（作为 SMILES）。 */
const active = ref(-1)
/** 默认选中的：输入有效的 SMILES 或没有输入时是输入的文字本身，否则是第一个匹配。 */
const first = computed(() => (typedValid.value || listingUsed.value || matches.value.length === 0 ? -1 : 0))
watch(query, () => (active.value = first.value), { immediate: true })
/** 列表的位置：插入新结构式时一开始就有，编辑时在第一次有匹配时出现；出现后不再收起（高度固定）。 */
const listShown = ref(listingUsed.value || matches.value.length > 0)
watch(matches, async (list) => {
  if (listShown.value || list.length === 0) return
  listShown.value = true
  await nextTick()
  place()
})

// 反应式
const reactants = ref(isReaction ? sideText(initialParts[0]) : '')
const reagents = isReaction ? initialParts[1].trim() : ''
const products = ref(isReaction ? sideText(initialParts[2]) : '')
const arrow = ref(initial.arrow)
const above = ref(initial.above)
const below = ref(initial.below)

// 分子的方向
const rotate = ref(initial.rotate)
const flip = ref(initial.flip)

function turn(degrees: number): void {
  rotate.value = normalizeRotate(rotate.value + degrees)
}

/** 左右翻转看到的样子：先翻转再旋转，因此翻转后旋转的方向相反。 */
function mirror(): void {
  flip.value = !flip.value
  rotate.value = normalizeRotate(-rotate.value)
}

/** 反应式中列出的匹配数上限。 */
const MAX_SUGGESTIONS = 5
const endsWithPlus = (text: string) => /[+＋]\s*$/.test(text)

/** 正在输入的一侧：它最后一项是名称的一部分时列出匹配。 */
const focusedSide = ref<'reactants' | 'products' | null>(null)
const sideRef = (side: 'reactants' | 'products') => (side === 'reactants' ? reactants : products)
const suggestions = computed<readonly Molecule[]>(() => {
  void libraryVersion.value
  if (focusedSide.value === null) return []
  const text = sideRef(focusedSide.value).value
  const term = endsWithPlus(text) ? '' : (splitTerms(text).at(-1) ?? '')
  if (term === '') return used.value.slice(0, MAX_SUGGESTIONS)
  if (moleculeByName(term) || isValidSmiles(smilesText(term))) return []
  return searchMolecules(term).slice(0, MAX_SUGGESTIONS)
})
const suggestion = ref(0)
watch(suggestions, () => (suggestion.value = 0))

/** 反应式中不认识的项（既不是库中的名称，也不是有效的 SMILES）。 */
const unknownTerms = computed(() => {
  void libraryVersion.value
  return mode.value === 'reaction'
    ? [...splitTerms(reactants.value), ...splitTerms(products.value)].filter((term) => !moleculeByName(term) && !isValidSmiles(smilesText(term)))
    : []
})

/** 完成时得到的结构式。 */
const target = computed<StructureValue & { readonly name: string | null }>(() => {
  void libraryVersion.value
  if (mode.value === 'molecule') {
    const molecule = active.value >= 0 ? matches.value[active.value] : null
    const smiles = molecule ? molecule.smiles : smilesText(query.value)
    const name = (molecule ?? moleculeBySmiles(smiles, true))?.names[0] ?? null
    return { smiles, arrow: '', above: '', below: '', rotate: rotate.value, flip: flip.value, name }
  }
  const left = sideSmiles(reactants.value)
  const right = sideSmiles(products.value)
  const smiles = left === '' && right === '' ? '' : `${left}>${reagents}>${right}`
  return { smiles, arrow: arrow.value, above: above.value.trim(), below: below.value.trim(), rotate: 0, flip: false, name: null }
})

/** 能旋转、翻转：画成骨架式的分子（写成化学式的无机小分子不能）。 */
const orientable = computed(
  () => mode.value === 'molecule' && !target.value.smiles.includes('>') && isValidSmiles(target.value.smiles) && !moleculeBySmiles(target.value.smiles)?.formula,
)

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

/**
 * 是名称而不是 SMILES：含有汉字，或是英文单词（字母开头，之后是小写字母、空格、连字符，且有 SMILES 中不会出现的小写字母，
 * SMILES 方括号外的小写字母只有芳香原子 b c n o p s 与 Cl、Br 中的 l、r）。
 */
const isName = (text: string) =>
  /[\u3400-\u9fff]/.test(text) || (/^[a-z][a-z\s'-]{2,}$/i.test(text.trim()) && /[ad-kmqt-z]/.test(text))

/** 无法画出时在预览中说明：名称不在库中，或 SMILES 的写法（标出出错的位置）。 */
function showProblem(element: HTMLElement, text: string): void {
  element.replaceChildren()
  element.classList.add('is-invalid')
  const problem = isName(text) || text.includes('>') ? null : smilesProblem(text)
  if (problem === null) {
    element.textContent = isName(text) ? `分子库中没有“${text}”，也可以直接输入 SMILES` : text
    return
  }
  const message = document.createElement('div')
  message.textContent = problem.message
  const at = problem.at
  if (at === null || at.start === at.end) {
    element.append(message)
    return
  }
  const code = document.createElement('div')
  code.className = 'structure-popover__problem-smiles'
  const mark = document.createElement('mark')
  mark.textContent = text.slice(at.start, at.end)
  code.append(text.slice(0, at.start), mark, text.slice(at.end))
  element.append(code, message)
}

function showPreview(): void {
  const element = preview.value
  if (!element) return
  const unknown = unknownTerms.value
  if (unknown.length > 0) {
    // 反应式中不认识的项：名称一起列出；写错的 SMILES 说明第一个。
    const names = unknown.filter(isName)
    if (names.length > 0) {
      element.replaceChildren()
      element.textContent = `不认识：${names.join('、')}（请使用分子库中的名称或 SMILES）`
      element.classList.add('is-invalid')
    } else showProblem(element, smilesText(unknown[0]))
    return
  }
  const { smiles } = target.value
  if (smiles === '') {
    element.replaceChildren()
    element.classList.remove('is-invalid')
    return
  }
  if (!isValidSmiles(smiles)) showProblem(element, smiles)
  else renderStructure(element, smiles, target.value)
}

watch(
  () => [target.value.smiles, target.value.arrow, target.value.above, target.value.below, target.value.rotate, target.value.flip, unknownTerms.value.join()],
  showPreview,
)

function commit(): void {
  const { smiles, arrow, above, below } = target.value
  const { rotate, flip } = target.value
  const unchanged =
    smiles === initial.smiles.trim() &&
    arrow === initial.arrow &&
    above === initial.above.trim() &&
    below === initial.below.trim() &&
    rotate === initial.rotate &&
    flip === initial.flip
  emit('commit', unchanged ? initial : { smiles, arrow, above, below, rotate, flip })
}

function pick(index: number): void {
  active.value = index
  commit()
}

/** 把一个匹配的 SMILES 填入输入框，在它的基础上修改。 */
function editSmiles(index: number): void {
  query.value = matches.value[index].smiles
  input.value?.focus({ preventScroll: true })
}

/** 把正在输入的一侧的最后一项换成匹配的分子（库中有的写名称）；一侧为空或刚输入“+”时添在最后。 */
function fill(side: 'reactants' | 'products', molecule: Molecule): void {
  const field = sideRef(side)
  const terms = splitTerms(field.value)
  const term = molecule.names[0] ?? molecule.smiles
  if (terms.length === 0 || endsWithPlus(field.value)) terms.push(term)
  else terms[terms.length - 1] = term
  field.value = terms.join(' + ')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  const last = matches.value.length - 1
  if (event.key === 'ArrowDown' && last >= 0) active.value = active.value >= last ? first.value : active.value + 1
  else if (event.key === 'ArrowUp' && last >= 0) active.value = active.value <= first.value ? last : active.value - 1
  else if (event.key === 'Enter') commit()
  else if (event.key === 'Tab' && !event.shiftKey && active.value >= 0) editSmiles(active.value)
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

/** 扩展库加载后重新查找；反应式的两侧还没有修改时，扩展库中的分子改写名称。 */
async function loadLibrary(): Promise<void> {
  const shown = [reactants.value, products.value]
  await loadExtendedMolecules()
  libraryVersion.value++
  if (!isReaction) return
  if (reactants.value === shown[0]) reactants.value = sideText(initialParts[0])
  if (products.value === shown[1]) products.value = sideText(initialParts[2])
}

onMounted(async () => {
  void loadLibrary()
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
      <div v-if="listShown" class="structure-popover__results">
        <div v-if="listingUsed && matches.length > 0" class="structure-popover__list-label">本文档中</div>
        <div v-if="matches.length === 0 && listingUsed" class="structure-popover__empty">输入中文或英文名称查找常见分子，也可以直接输入 SMILES</div>
        <div
          v-if="matches.length > 0"
          :id="`${id}-list`"
          class="structure-popover__list"
          role="listbox"
          :aria-label="listingUsed ? '本文档中用过的分子' : '常见分子'"
        >
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
            <span v-if="molecule.names.length > 0" class="structure-popover__name">{{ molecule.names[0] }}</span>
            <span v-else class="structure-popover__name structure-popover__name--smiles" :title="molecule.smiles">{{ molecule.smiles }}</span>
            <span class="structure-popover__english">{{ molecule.english }}</span>
            <span v-if="molecule.extended" class="structure-popover__source" title="扩展分子库（来自 Wikidata）">扩展</span>
            <button
              v-if="index === active"
              type="button"
              class="structure-popover__hint"
              tabindex="-1"
              title="把 SMILES 填入输入框修改（Tab）"
              @mousedown.prevent
              @click.stop="editSmiles(index)"
            >
              <span class="structure-popover__key">⇥</span>编辑 SMILES
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="structure-popover__fields">
      <template v-for="side in ['reactants', 'products'] as const" :key="side">
        <label class="structure-popover__field-label" :class="{ 'is-products': side === 'products' }" :for="`${id}-${side}`">
          {{ side === 'reactants' ? '反应物' : '产物' }}
        </label>
        <div class="structure-popover__field" :class="{ 'is-products': side === 'products' }">
          <input
            :id="`${id}-${side}`"
            :ref="side === 'reactants' ? (element) => (reactantsInput = element as HTMLInputElement | null) : undefined"
            v-model="sideRef(side).value"
            class="structure-popover__input"
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
            role="listbox"
            :aria-label="splitTerms(sideRef(side).value).length === 0 || endsWithPlus(sideRef(side).value) ? '本文档中用过的分子' : '常见分子'"
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
              <span v-if="molecule.names.length > 0" class="structure-popover__name">{{ molecule.names[0] }}</span>
              <span v-else class="structure-popover__name structure-popover__name--smiles" :title="molecule.smiles">{{ molecule.smiles }}</span>
              <span class="structure-popover__english">{{ molecule.english }}</span>
              <span v-if="molecule.extended" class="structure-popover__source" title="扩展分子库（来自 Wikidata）">扩展</span>
            </div>
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

    <div class="structure-popover__stage">
      <div ref="preview" class="structure-popover__preview" aria-live="polite"></div>
      <div v-if="orientable" class="structure-popover__orient" role="group" aria-label="方向">
        <button
          v-for="item in [
            { label: '向左旋转 30°', glyph: '↺', run: () => turn(-ROTATE_STEP) },
            { label: '向右旋转 30°', glyph: '↻', run: () => turn(ROTATE_STEP) },
            { label: '左右翻转', glyph: '⇆', run: mirror },
          ]"
          :key="item.label"
          type="button"
          class="structure-popover__orient-button"
          :aria-label="item.label"
          :title="item.label"
          tabindex="-1"
          @mousedown.prevent
          @click="item.run"
        >
          {{ item.glyph }}
        </button>
      </div>
    </div>
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

/* 本文档中用过的分子：与反应式字段标签相同的安静文字。 */
.structure-popover__list-label {
  margin-top: var(--space-1);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  -webkit-user-select: none;
  user-select: none;
}

/* 匹配的分子：与文献引用浮层相同的选中样式。 */
/* 列表的位置高度固定（约 6 行，多的滚动），匹配的数量变化时预览不移动。 */
.structure-popover__results {
  display: flex;
  flex-direction: column;
  height: 188px;
}

.structure-popover__list {
  flex: 1;
  min-height: 0;
  margin: var(--space-1) calc(-1 * var(--space-3)) 0;
  overflow-y: auto;
}

.structure-popover__empty {
  margin: auto;
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  text-align: center;
  -webkit-user-select: none;
  user-select: none;
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

.structure-popover__name--smiles {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-s);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.structure-popover__english {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 选中的一行末尾的按钮：在强调色上用细边框表示可以点击。 */
.structure-popover__hint {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
  height: 20px;
  margin: -2px calc(-1 * var(--space-2)) -2px auto;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  box-shadow: inset 0 0 0 1px currentColor;
  color: inherit;
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  opacity: 0.75;
  cursor: default;
}

.structure-popover__hint:hover {
  opacity: 1;
}

.structure-popover__source {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--text-xs);
}

.structure-popover__option--active .structure-popover__source,
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
.structure-popover__field.is-products {
  order: 2;
}

/* 输入框与浮在其下方的匹配。 */
.structure-popover__field {
  position: relative;
  min-width: 0;
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
  position: absolute;
  top: calc(100% + var(--space-1));
  right: 0;
  left: 0;
  z-index: 1;
  padding: var(--space-1);
  border-radius: var(--radius-m);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-popover);
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

/* 预览：与公式浮层的预览相同的底色，结构式随正文颜色；高度固定，过大的结构式按比例缩小。 */
.structure-popover__stage {
  position: relative;
  margin-top: var(--space-3);
}

.structure-popover__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 180px;
  padding: var(--space-4);
  overflow: hidden;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  color: var(--color-doc-text);
}

.structure-popover__preview.is-invalid {
  flex-direction: column;
  gap: var(--space-1);
  color: var(--color-danger-text);
  font-family: var(--font-ui);
  font-size: var(--text-s);
  text-align: center;
}

/* 方向：预览右上角安静的按钮，与箭头按钮相同的状态。 */
.structure-popover__orient {
  position: absolute;
  top: var(--space-1);
  right: var(--space-1);
  display: flex;
  gap: 1px;
}

.structure-popover__orient-button {
  width: var(--control-h-s);
  height: var(--control-h-s);
  padding: 0;
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: var(--text-m);
  line-height: 1;
  cursor: default;
}

.structure-popover__orient-button:hover {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.structure-popover__orient-button:active {
  background: var(--color-fill-pressed);
}

/* SMILES 的写法有误：原文中标出出错的字符，下方是说明。 */
.structure-popover__preview :deep(.structure-popover__problem-smiles) {
  max-width: 100%;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-s);
  overflow-wrap: anywhere;
}

.structure-popover__preview :deep(mark) {
  border-radius: var(--radius-s);
  background: var(--color-danger-fill);
  color: var(--color-danger-text);
  font-weight: 600;
}

.structure-popover__preview :deep(svg) {
  flex: none;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 100%;
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
.structure-popover__arrow:focus-visible,
.structure-popover__orient-button:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
}

.structure-popover__key {
  color: var(--color-text-tertiary);
}

.structure-popover__hint .structure-popover__key {
  color: inherit;
}
</style>
