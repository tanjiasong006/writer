<script lang="ts">
/** 本次运行中最近使用的编辑方式：熟悉 LaTeX 的人切换到源码后，下次打开仍是源码。 */
let preferSource = false
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import katex from 'katex'
import { MathfieldElement } from 'mathlive'
import { renderMath } from './math_view.ts'
import { chemContent, chemTex } from './chem.ts'
import { ELEMENTS, type Element } from './periodic_table.ts'

/**
 * 编辑公式（docs/decisions.md 第 14 节）：在公式（或插入处）下方弹出。
 *
 * - 默认是可视编辑（MathLive）：直接编辑排好版的公式，上方是常用结构与符号；输入 / 生成分数、^ 上标、_ 下标，
 *   方向键在各部分之间移动。
 * - “LaTeX”切换到源码：文本框加实时预览；⇧Enter 换行（公式块可以多行）。
 * - 化学式（chem，docs/decisions.md 第 22 节）：直接写 \ce{…} 的内容（如 2H2 + O2 -> 2H2O），上方是箭头、气体、沉淀等常用写法，
 *   下方是实时预览；没有可视编辑与 LaTeX 切换。“周期表”展开元素周期表，点击元素在光标处插入元素符号。
 * - Enter 或“完成”按钮完成，Esc 或“取消”按钮放弃；点击浮层以外也完成。没有修改时完成得到原文（可视编辑器不改写未编辑的写法）。
 * - 只发出 commit / cancel，正文由编辑器修改。
 */
const props = defineProps<{
  anchor: { readonly x: number; readonly y: number }
  label: string
  tex: string
  display: boolean
  chem?: boolean
}>()

const emit = defineEmits<{
  commit: [tex: string]
  cancel: []
}>()

// 字体用 katex.min.css 已经加载的 KaTeX 字体（MathLive 使用同一套），不另行加载；不播放按键声音。
MathfieldElement.fontsDirectory = null
MathfieldElement.soundsDirectory = null

const value = ref(props.tex)
const initialChem = props.chem ? (chemContent(props.tex) ?? props.tex) : ''
const chemText = ref(initialChem)
const chemInput = ref<HTMLTextAreaElement | null>(null)
const source = ref(preferSource)
const showSymbols = ref(false)
const showElements = ref(false)
/** 周期表中指向的元素，在表上方的空白处显示序数与名称。 */
const pointedElement = ref<Element | null>(null)
const panel = ref<HTMLElement | null>(null)
const fieldHost = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
const preview = ref<HTMLElement | null>(null)
const position = ref<{ left: number; top?: number; bottom?: number } | null>(null)
let mathfield: MathfieldElement | null = null

const EDGE = 8
const GAP = 6
const LINE = 28

/** 插入的写法：#0 是当前选中的内容，#? 是待填写的空位。 */
interface Template {
  readonly label: string
  readonly icon: string
  readonly insert: string
}

const STRUCTURES: readonly Template[] = [
  { label: '分数', icon: '\\dfrac{\\square}{\\square}', insert: '\\frac{#0}{#?}' },
  { label: '上标', icon: '\\square^{\\square}', insert: '#0^{#?}' },
  { label: '下标', icon: '\\square_{\\square}', insert: '#0_{#?}' },
  { label: '根号', icon: '\\sqrt{\\square}', insert: '\\sqrt{#0}' },
  { label: 'n 次根号', icon: '\\sqrt[\\square]{\\square}', insert: '\\sqrt[#?]{#0}' },
  { label: '括号', icon: '\\left(\\square\\right)', insert: '\\left(#0\\right)' },
  { label: '求和', icon: '\\sum', insert: '\\sum_{#?}^{#?}' },
  { label: '积分', icon: '\\int', insert: '\\int_{#?}^{#?}' },
  { label: '极限', icon: '\\lim', insert: '\\lim_{#?\\to #?}' },
  { label: '矩阵', icon: '\\begin{pmatrix}\\square&\\square\\\\\\square&\\square\\end{pmatrix}', insert: '\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}' },
  { label: '方程组', icon: '\\begin{cases}\\square\\\\\\square\\end{cases}', insert: '\\begin{cases}#?\\\\#?\\end{cases}' },
]

const SYMBOLS: readonly string[] = [
  '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\theta', '\\lambda', '\\mu', '\\pi', '\\rho', '\\sigma', '\\varphi', '\\omega',
  '\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Sigma', '\\Phi', '\\Omega',
  '\\pm', '\\times', '\\div', '\\cdot', '\\le', '\\ge', '\\ne', '\\approx', '\\equiv', '\\propto',
  '\\infty', '\\partial', '\\nabla', '\\to', '\\Rightarrow', '\\Leftrightarrow',
  '\\in', '\\notin', '\\subset', '\\subseteq', '\\cup', '\\cap', '\\forall', '\\exists', '\\angle', '\\degree',
]

/** 化学式的常用写法：在光标处插入 before + select + after，select 是选中的待填写文字（有选中的文字时用它）。 */
interface ChemTemplate {
  readonly label: string
  readonly icon: string
  readonly before: string
  readonly select?: string
  readonly after?: string
}

const CHEM_TOOLS: readonly ChemTemplate[] = [
  { label: '生成', icon: '\\ce{->}', before: ' -> ' },
  { label: '反应条件（->[上方][下方]）', icon: '\\ce{->[\\square]}', before: ' ->[', select: '条件', after: '] ' },
  { label: '可逆反应', icon: '\\ce{<=>}', before: ' <=> ' },
  { label: '等号与条件', icon: '\\xlongequal{\\square}', before: ' \\xlongequal{', select: '条件', after: '} ' },
  { label: '气体', icon: '\\uparrow', before: ' ^ ' },
  { label: '沉淀', icon: '\\downarrow', before: ' v ' },
  { label: '加热', icon: '\\Delta', before: '\\Delta' },
  { label: '电荷（如 SO4^2-）', icon: '\\square^{n+}', before: '^', select: '2+' },
  { label: '结晶水（如 CuSO4*5H2O）', icon: '\\square\\cdot\\square', before: '*' },
]

const icon = (tex: string) => katex.renderToString(tex, { throwOnError: false, output: 'html' })
const structureIcons = STRUCTURES.map((item) => icon(item.icon))
const symbolIcons = SYMBOLS.map(icon)
const chemIcons = props.chem ? CHEM_TOOLS.map((item) => icon(item.icon)) : []

function place(): void {
  const element = panel.value
  if (!element) return
  const { x, y } = props.anchor
  const left = Math.max(EDGE, Math.min(x - 24, window.innerWidth - element.offsetWidth - EDGE))
  const height = element.offsetHeight
  if (y + GAP + height <= window.innerHeight - EDGE) position.value = { left, top: y + GAP }
  else if (y - LINE - GAP - height >= EDGE) position.value = { left, bottom: window.innerHeight - (y - LINE - GAP) }
  // 上下都放不下（如展开周期表）时贴着窗口底边，宁可盖住公式，也不让浮层超出窗口。
  else position.value = { left, top: Math.max(EDGE, window.innerHeight - height - EDGE) }
}

function showPreview(): void {
  if (!preview.value) return
  const tex = props.chem ? chemTex(chemText.value) : value.value
  if (tex.trim() === '') {
    preview.value.textContent = ''
    preview.value.classList.remove('is-invalid')
    return
  }
  renderMath(preview.value, tex, props.display)
}

watch([value, chemText], showPreview)

function commit(): void {
  if (props.chem) emit('commit', chemText.value === initialChem ? props.tex.trim() : chemTex(chemText.value))
  else emit('commit', value.value.trim())
}

/** 在化学式的光标处插入常用写法；两侧的空格不与已有的空白重复。 */
async function insertChem(item: Pick<ChemTemplate, 'before' | 'select' | 'after'>): Promise<void> {
  const input = chemInput.value
  if (!input) return
  const text = chemText.value
  const start = input.selectionStart
  const end = input.selectionEnd
  const selected = text.slice(start, end)
  let before = item.before
  let after = item.after ?? ''
  const spaceAfter = /\s/.test(text[end] ?? '')
  if (start === 0 || /\s/.test(text[start - 1])) before = before.trimStart()
  if (spaceAfter) after = after.trimEnd()
  if (spaceAfter && item.select === undefined) before = before.trimEnd()
  const middle = item.select === undefined ? '' : selected || item.select
  chemText.value = text.slice(0, start) + before + middle + after + text.slice(end)
  await nextTick()
  input.focus({ preventScroll: true })
  const from = start + before.length
  if (item.select !== undefined && selected === '') input.setSelectionRange(from, from + middle.length)
  else input.setSelectionRange(from + middle.length + after.length, from + middle.length + after.length)
}

async function toggleElements(): Promise<void> {
  showElements.value = !showElements.value
  pointedElement.value = null
  await nextTick()
  place()
}

function onSourceKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    commit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
  }
}

/** 先于 MathLive 处理 Enter 与 Esc（MathLive 中 Esc 是输入 LaTeX 命令）；正在输入 LaTeX 命令时交给 MathLive。 */
function onFieldKeydown(event: KeyboardEvent): void {
  if (event.isComposing || mathfield?.mode === 'latex') return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    event.stopPropagation()
    commit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
  }
}

/**
 * 可视编辑器中的公式 → 保存的 LaTeX：展开 MathLive 自己的命令（如 \differentialD → \mathrm{d}，KaTeX 与导出都不认识前者），
 * 去掉未填写的空位；没有填写次数的根号写成普通根号（导出不接受 \sqrt[]）。
 */
function fieldLatex(field: MathfieldElement): string {
  return field
    .getValue('latex-expanded')
    .replace(/\\placeholder(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1')
    .replace(/\\sqrt\[\]/g, '\\sqrt')
}

function createMathfield(): void {
  if (!fieldHost.value) return
  const field = new MathfieldElement()
  field.setAttribute('aria-label', props.label)
  // 选项要在挂载之后设置。
  fieldHost.value.append(field)
  field.mathVirtualKeyboardPolicy = 'manual'
  field.menuItems = []
  field.defaultMode = props.display ? 'math' : 'inline-math'
  field.value = value.value
  field.addEventListener('input', () => {
    value.value = fieldLatex(field)
  })
  fieldHost.value.addEventListener('keydown', onFieldKeydown, { capture: true })
  mathfield = field
}

function insertTemplate(latex: string): void {
  if (!mathfield) return
  mathfield.insert(latex, { selectionMode: 'placeholder', focus: true })
  value.value = fieldLatex(mathfield)
}

async function focusEditor(selectAll: boolean): Promise<void> {
  await nextTick()
  if (props.chem) {
    chemInput.value?.focus({ preventScroll: true })
    if (selectAll) chemInput.value?.select()
  } else if (source.value) {
    input.value?.focus({ preventScroll: true })
    if (selectAll) input.value?.select()
  } else {
    mathfield?.focus()
    if (selectAll) mathfield?.executeCommand('selectAll')
  }
}

async function toggleSource(): Promise<void> {
  source.value = !source.value
  preferSource = source.value
  showSymbols.value = false
  if (!source.value && mathfield && fieldLatex(mathfield) !== value.value) mathfield.value = value.value
  await nextTick()
  showPreview()
  place()
  await focusEditor(false)
}

onMounted(async () => {
  if (!props.chem) createMathfield()
  showPreview()
  place()
  await focusEditor(true)
})

onBeforeUnmount(() => {
  fieldHost.value?.removeEventListener('keydown', onFieldKeydown, { capture: true })
})
</script>

<template>
  <div class="math-popover__backdrop" @mousedown.prevent="commit"></div>
  <div
    ref="panel"
    class="math-popover"
    role="dialog"
    :aria-label="label"
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
    <div class="math-popover__label">{{ label }}</div>

    <template v-if="chem">
      <div class="math-popover__tools" role="toolbar" aria-label="插入化学式写法">
        <button
          v-for="(item, index) in CHEM_TOOLS"
          :key="item.label"
          type="button"
          class="math-popover__tool"
          :title="item.label"
          :aria-label="item.label"
          tabindex="-1"
          @mousedown.prevent
          @click="insertChem(item)"
          v-html="chemIcons[index]"
        ></button>
        <button
          type="button"
          class="math-popover__tool math-popover__tool--text"
          :aria-pressed="showElements"
          tabindex="-1"
          @mousedown.prevent
          @click="toggleElements"
        >
          周期表
        </button>
      </div>
      <div
        v-if="showElements"
        class="math-popover__elements"
        role="toolbar"
        aria-label="插入元素符号"
        @mouseleave="pointedElement = null"
      >
        <div class="math-popover__element-info" aria-hidden="true">
          <template v-if="pointedElement">
            <span class="math-popover__element-number">{{ pointedElement.number }}</span>
            <span class="math-popover__element-symbol">{{ pointedElement.symbol }}</span>
            {{ pointedElement.name }}
          </template>
        </div>
        <button
          v-for="element in ELEMENTS"
          :key="element.symbol"
          type="button"
          class="math-popover__element"
          :style="{ gridRow: element.row, gridColumn: element.column }"
          :aria-label="`${element.name} ${element.symbol}`"
          tabindex="-1"
          @mousedown.prevent
          @mouseenter="pointedElement = element"
          @click="insertChem({ before: element.symbol })"
        >
          {{ element.symbol }}
        </button>
      </div>
      <div class="math-popover__field math-popover__field--chem" :data-value="chemText">
        <textarea
          ref="chemInput"
          v-model="chemText"
          class="math-popover__input"
          rows="1"
          placeholder="在这里输入化学式，如 2H2 + O2 -> 2H2O"
          :aria-label="label"
          spellcheck="false"
          autocomplete="off"
          @keydown="onSourceKeydown"
        ></textarea>
      </div>
      <div ref="preview" class="math-popover__preview document-body" aria-live="polite"></div>
    </template>

    <div v-show="!source && !chem" class="math-popover__visual">
      <div class="math-popover__tools" role="toolbar" aria-label="插入结构">
        <button
          v-for="(item, index) in STRUCTURES"
          :key="item.label"
          type="button"
          class="math-popover__tool"
          :title="item.label"
          :aria-label="item.label"
          tabindex="-1"
          @mousedown.prevent
          @click="insertTemplate(item.insert)"
          v-html="structureIcons[index]"
        ></button>
        <button
          type="button"
          class="math-popover__tool math-popover__tool--text"
          :aria-pressed="showSymbols"
          tabindex="-1"
          @mousedown.prevent
          @click="showSymbols = !showSymbols"
        >
          符号
        </button>
      </div>
      <div v-if="showSymbols" class="math-popover__symbols" role="toolbar" aria-label="插入符号">
        <button
          v-for="(symbol, index) in SYMBOLS"
          :key="symbol"
          type="button"
          class="math-popover__tool math-popover__tool--symbol"
          :title="symbol"
          :aria-label="symbol"
          tabindex="-1"
          @mousedown.prevent
          @click="insertTemplate(symbol)"
          v-html="symbolIcons[index]"
        ></button>
      </div>
      <div ref="fieldHost" class="math-popover__visual-field" :class="{ 'is-display': display }"></div>
    </div>

    <template v-if="source && !chem">
      <div class="math-popover__field" :data-value="value">
        <textarea
          ref="input"
          v-model="value"
          class="math-popover__input"
          rows="1"
          placeholder="LaTeX，如 \frac{a}{b}"
          aria-label="LaTeX"
          spellcheck="false"
          autocomplete="off"
          @keydown="onSourceKeydown"
        ></textarea>
      </div>
      <div ref="preview" class="math-popover__preview document-body" aria-live="polite"></div>
    </template>

    <div class="math-popover__footer">
      <span v-if="chem" class="math-popover__hint">数字自动成为下标</span>
      <button
        v-else
        type="button"
        class="math-popover__mode"
        :aria-pressed="source"
        @mousedown.prevent
        @click="toggleSource"
      >
        LaTeX
      </button>
      <div class="math-popover__actions">
        <span v-if="source && !chem" class="math-popover__hint">⇧↩ 换行</span>
        <button type="button" class="math-popover__action" @mousedown.prevent @click="emit('cancel')">
          <span class="math-popover__key">⎋</span>取消
        </button>
        <button type="button" class="math-popover__action is-default" @mousedown.prevent @click="commit">
          <span class="math-popover__key">↩</span>完成
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.math-popover__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.math-popover {
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
  animation: math-popover-in var(--duration-fast) var(--ease-out);
  /* 不超出窗口：放不下时只有周期表在浮层内滚动，输入框、预览与按钮始终可见。 */
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 2 * var(--space-4));
}

.math-popover > * {
  flex: none;
}

@keyframes math-popover-in {
  from {
    opacity: 0;
  }
}

.math-popover__label {
  margin-bottom: var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  -webkit-user-select: none;
  user-select: none;
}

/* 常用结构与符号：安静的图标按钮，悬停时才有底色。 */
.math-popover__tools,
.math-popover__symbols {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0 calc(-1 * var(--space-2));
}

.math-popover__symbols {
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-separator);
}

.math-popover__tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--control-h-m);
  height: var(--control-h-m);
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--text-s);
  line-height: 1;
  cursor: default;
}

.math-popover__tool:hover {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.math-popover__tool:active {
  background: var(--color-fill-pressed);
}

.math-popover__tool[aria-pressed='true'] {
  background: var(--color-accent-fill);
  color: var(--color-accent-text);
}

/* 按钮中的公式图标：结构图标缩小到按钮高度内，符号保持正常大小。 */
.math-popover__tool :deep(.katex) {
  font-size: 11px;
}

.math-popover__tool--symbol :deep(.katex) {
  font-size: var(--text-l);
}

.math-popover__tool--text {
  margin-left: auto;
  font-family: var(--font-ui);
}

/* 可视编辑区：与源码模式的预览同一底色，比界面文字大，便于看清上下标。 */
.math-popover__visual-field {
  margin-top: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
}

.math-popover__visual-field :deep(math-field) {
  display: block;
  width: 100%;
  min-height: 1.6em;
  border: none;
  background: transparent;
  color: var(--color-doc-text);
  font-size: 18px;
  outline: none;
  --caret-color: var(--color-accent);
  --selection-background-color: var(--color-doc-selection);
  --selection-color: inherit;
  --contains-highlight-background-color: transparent;
  --placeholder-color: var(--color-text-tertiary);
  --smart-fence-color: var(--color-text-tertiary);
  --primary: var(--color-accent);
}

.math-popover__visual-field.is-display :deep(math-field) {
  font-size: 20px;
}

.math-popover__visual-field :deep(math-field)::part(menu-toggle),
.math-popover__visual-field :deep(math-field)::part(virtual-keyboard-toggle) {
  display: none;
}

/*
 * 元素周期表：18 族 × 7 周期，镧系与锕系隔开一行排在下方；与常用写法同样安静的文字按钮，不按元素分区着色。
 * 表上方第 4–11 族的空白处显示指向的元素。
 */
.math-popover__elements {
  display: grid;
  grid-template-columns: repeat(18, 1fr);
  grid-template-rows: repeat(7, var(--control-h-s)) var(--space-3) repeat(2, var(--control-h-s));
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  gap: 1px;
  margin: var(--space-2) calc(-1 * var(--space-2)) 0;
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-separator);
}

.math-popover__element {
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  line-height: 1;
  cursor: default;
}

.math-popover__element:hover {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.math-popover__element:active {
  background: var(--color-fill-pressed);
}

.math-popover__element-info {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--space-3);
  grid-row: 1 / 3;
  grid-column: 4 / 12;
  align-self: center;
  color: var(--color-text-secondary);
  font-size: var(--text-s);
  -webkit-user-select: none;
  user-select: none;
}

.math-popover__element-number {
  color: var(--color-text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.math-popover__element-symbol {
  color: var(--color-text);
  font-size: var(--text-xl);
  font-weight: var(--weight-medium);
}

/* 化学式的输入框在常用写法之下：有边框，与下方填充底色的预览区分开，一眼看出在哪里输入；聚焦时是焦点环。 */
.math-popover__field--chem {
  margin-top: var(--space-2);
  border-radius: var(--radius-m);
  box-shadow: inset 0 0 0 1px var(--color-control-border);
  cursor: text;
}

/* 内边距在文本框上，整个框都能点进去输入。 */
.math-popover__field.math-popover__field--chem::after,
.math-popover__field--chem .math-popover__input {
  padding: var(--space-3) var(--space-4);
}

.math-popover__field--chem:focus-within {
  box-shadow:
    inset 0 0 0 1px var(--color-accent),
    0 0 0 2px var(--color-focus-ring);
}

/* 随内容增高的文本框（与脚注浮层相同的做法），等宽字体。 */
.math-popover__field {
  display: grid;
  max-height: 200px;
  overflow-y: auto;
}

.math-popover__field::after,
.math-popover__input {
  grid-area: 1 / 1;
  box-sizing: border-box;
  margin: 0;
  padding: var(--space-2) 0;
  border: none;
  font-family: var(--font-mono);
  font-size: var(--text-m);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.math-popover__field::after {
  content: attr(data-value) ' ';
  visibility: hidden;
}

.math-popover__input {
  width: 0;
  min-width: 100%;
  overflow: hidden;
  resize: none;
  background: transparent;
  color: inherit;
  outline: none;
}

.math-popover__input::placeholder {
  color: var(--color-text-tertiary);
}

/* 预览：与正文相同的字体与颜色，过宽时横向滚动。 */
.math-popover__preview {
  min-height: 1.6em;
  margin-top: var(--space-3);
  padding: var(--space-4);
  overflow-x: auto;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  text-align: center;
}

.math-popover__preview.is-invalid {
  color: var(--color-danger-text);
  font-family: var(--font-mono);
  font-size: var(--text-s);
}

.math-popover__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-separator);
}

/* 切换到源码：低调的文字按钮，打开时是强调色。 */
.math-popover__mode {
  height: var(--control-h-s);
  margin-left: calc(-1 * var(--space-3));
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: default;
}

.math-popover__mode:hover {
  background: var(--color-fill-hover);
  color: var(--color-text-secondary);
}

.math-popover__mode[aria-pressed='true'] {
  background: var(--color-accent-fill);
  color: var(--color-accent-text);
}

/* 取消 / 完成：与“LaTeX”同样低调的文字按钮，按键符号提示快捷键；完成是默认操作，用强调色文字。 */
.math-popover__actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-right: calc(-1 * var(--space-3));
}

.math-popover__action {
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

.math-popover__action.is-default {
  color: var(--color-accent-text);
}

.math-popover__action:hover {
  background: var(--color-fill-hover);
}

.math-popover__action:active {
  background: var(--color-fill-pressed);
}

.math-popover__key {
  color: var(--color-text-tertiary);
}

.math-popover__mode:focus-visible,
.math-popover__action:focus-visible,
.math-popover__tool:focus-visible,
.math-popover__element:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
}

.math-popover__hint {
  margin-right: var(--space-3);
  color: var(--color-text-tertiary);
  font-size: var(--text-xs);
  -webkit-user-select: none;
  user-select: none;
}
</style>
