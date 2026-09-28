<script setup lang="ts">
import { computed } from 'vue'
import {
  THEME_IDS,
  resolveTheme,
  type DocumentStyle,
  type FontId,
  type StyleOverrides,
  type ThemeId,
} from '../../domain/document_style/document_style.ts'

/**
 * 文档样式设置：整本文档的主题，以及在主题之上调整的少数正文 / 标题字段。
 * 只提供受控的选项（Word / PDF 都能可靠输出的字体族、常用字号），不提供系统字体列表与任意数值。
 * 显示的是实际生效的值（主题值或调整后的值）；与主题相同的选择即恢复跟随主题。
 */
const props = defineProps<{ documentStyle: DocumentStyle }>()

const emit = defineEmits<{
  'select-theme': [theme: ThemeId]
  override: [patch: StyleOverrides]
  reset: []
}>()

const THEME_LABELS: Readonly<Record<ThemeId, { readonly name: string; readonly description: string }>> = {
  book: { name: '书籍', description: '宋体正文、黑体标题，适合大多数长文档' },
  classic: { name: '传统', description: '全部宋体，行距宽松' },
  technical: { name: '技术文档', description: '全部黑体，紧凑，图片默认较大' },
}

const FONTS: ReadonlyArray<{ readonly value: FontId; readonly label: string; readonly title: string }> = [
  { value: 'serif', label: '宋体', title: '宋体类（衬线），英文为 Times New Roman 类' },
  { value: 'sans', label: '黑体', title: '黑体类（无衬线），英文为 Arial 类' },
]

/** 中文字号名，便于和 Word 中的习惯对应。 */
const SIZE_NAMES: Readonly<Record<number, string>> = {
  9: '小五',
  10.5: '五号',
  12: '小四',
  14: '四号',
  15: '小三',
  16: '三号',
  18: '小二',
  22: '二号',
  24: '小一',
}
const BODY_SIZES = [9, 10, 10.5, 11, 12, 14]
const HEADING_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 22, 24]
const LINE_HEIGHTS = [1.4, 1.6, 1.8, 2, 2.4]

const theme = computed(() => resolveTheme(props.documentStyle))
const adjusted = computed(() => Object.keys(props.documentStyle.overrides).length > 0)

/** 选项列表；当前值不在列表中（例如手动编辑过项目文件）时也列出，避免显示错误的值。 */
function withCurrent(options: readonly number[], current: number): number[] {
  return options.includes(current) ? [...options] : [...options, current].sort((a, b) => a - b)
}

function sizeLabel(size: number): string {
  const name = SIZE_NAMES[size]
  return name ? `${size} 磅（${name}）` : `${size} 磅`
}

const headingSizeFields = [
  { field: 'heading1Size', label: '一级', level: 'heading1' },
  { field: 'heading2Size', label: '二级', level: 'heading2' },
  { field: 'heading3Size', label: '三级', level: 'heading3' },
] as const

function selectNumber(field: keyof StyleOverrides, event: Event): void {
  emit('override', { [field]: Number((event.target as HTMLSelectElement).value) })
}
</script>

<template>
  <section class="style-panel" aria-label="文档样式">
    <h3 class="style-panel__title">文档样式</h3>

    <label class="style-panel__row">
      <span class="style-panel__label">主题</span>
      <select
        class="style-panel__select"
        :value="documentStyle.theme"
        @change="emit('select-theme', ($event.target as HTMLSelectElement).value as ThemeId)"
      >
        <option v-for="id in THEME_IDS" :key="id" :value="id">{{ THEME_LABELS[id].name }}</option>
      </select>
    </label>
    <p class="style-panel__hint">{{ THEME_LABELS[documentStyle.theme].description }}</p>

    <h4 class="style-panel__section">正文</h4>
    <div class="style-panel__row">
      <span class="style-panel__label">字体</span>
      <div class="style-panel__segmented" role="group" aria-label="正文字体">
        <button
          v-for="font in FONTS"
          :key="font.value"
          type="button"
          tabindex="0"
          :class="{ 'style-panel__option--active': theme.body.font === font.value }"
          :aria-pressed="theme.body.font === font.value"
          :title="font.title"
          @click="emit('override', { bodyFont: font.value })"
        >
          {{ font.label }}
        </button>
      </div>
    </div>
    <label class="style-panel__row">
      <span class="style-panel__label">字号</span>
      <select class="style-panel__select" :value="theme.body.size" @change="selectNumber('bodySize', $event)">
        <option v-for="size in withCurrent(BODY_SIZES, theme.body.size)" :key="size" :value="size">
          {{ sizeLabel(size) }}
        </option>
      </select>
    </label>
    <label class="style-panel__row">
      <span class="style-panel__label">行距</span>
      <select class="style-panel__select" :value="theme.body.lineHeight" @change="selectNumber('lineHeight', $event)">
        <option v-for="value in withCurrent(LINE_HEIGHTS, theme.body.lineHeight)" :key="value" :value="value">
          {{ value }} 倍
        </option>
      </select>
    </label>

    <h4 class="style-panel__section">标题</h4>
    <div class="style-panel__row">
      <span class="style-panel__label">字体</span>
      <div class="style-panel__segmented" role="group" aria-label="标题字体">
        <button
          v-for="font in FONTS"
          :key="font.value"
          type="button"
          tabindex="0"
          :class="{ 'style-panel__option--active': theme.heading1.font === font.value }"
          :aria-pressed="theme.heading1.font === font.value"
          :title="font.title"
          @click="emit('override', { headingFont: font.value })"
        >
          {{ font.label }}
        </button>
      </div>
    </div>
    <label v-for="item in headingSizeFields" :key="item.field" class="style-panel__row">
      <span class="style-panel__label">{{ item.label }}</span>
      <select class="style-panel__select" :value="theme[item.level].size" @change="selectNumber(item.field, $event)">
        <option v-for="size in withCurrent(HEADING_SIZES, theme[item.level].size)" :key="size" :value="size">
          {{ sizeLabel(size) }}
        </option>
      </select>
    </label>

    <div class="style-panel__footer">
      <span class="style-panel__hint">{{ adjusted ? '已在主题基础上调整' : '使用主题默认设置' }}</span>
      <button v-if="adjusted" type="button" class="style-panel__reset" tabindex="0" @click="emit('reset')">恢复主题默认</button>
    </div>
  </section>
</template>

<style scoped>
.style-panel {
  width: 280px;
  box-sizing: border-box;
  padding: var(--space-5) var(--space-6) var(--space-6);
  color: var(--color-text);
  font-size: var(--text-m);
  -webkit-user-select: none;
  user-select: none;
}

.style-panel__title {
  margin: 0 0 var(--space-4);
  font-size: var(--text-m);
  font-weight: var(--weight-semibold);
}

.style-panel__section {
  margin: var(--space-6) 0 var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  font-weight: var(--weight-medium);
}

.style-panel__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  min-height: var(--control-h-l);
}

.style-panel__label {
  flex: none;
  color: var(--color-text-secondary);
}

/* 自绘下拉框外观：与分段控件同宽同高，右侧一个小箭头。 */
.style-panel__select {
  width: 156px;
  height: var(--control-h-s);
  padding: 0 22px 0 var(--space-4);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-bg)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M5 6.5 8 9.5l3-3' fill='none' stroke='%238a8a8f' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
    no-repeat right 5px center / 14px;
  box-shadow: inset 0 0 0 1px var(--color-control-border);
  color: inherit;
  font: inherit;
  -webkit-appearance: none;
  appearance: none;
}

.style-panel__select:hover {
  box-shadow: inset 0 0 0 1px var(--color-separator-strong), 0 0 0 0 transparent;
  background-color: var(--color-bg);
}

.style-panel__select:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--color-accent), 0 0 0 3px var(--color-accent-fill-strong);
}

.style-panel__segmented {
  display: flex;
  width: 156px;
  height: var(--control-h-s);
  box-sizing: border-box;
  padding: 2px;
  border-radius: var(--radius-m);
  background: var(--color-fill-pressed);
}

.style-panel__segmented button {
  flex: 1;
  padding: 0;
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--text-s);
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.style-panel__segmented button:hover:not(.style-panel__option--active) {
  color: var(--color-text);
}

.style-panel__segmented .style-panel__option--active {
  background: var(--color-bg);
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.1);
  color: var(--color-text);
  font-weight: var(--weight-medium);
}

.style-panel__hint {
  margin: var(--space-1) 0 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  line-height: var(--leading-tight);
}

.style-panel__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: var(--control-h-s);
  margin-top: var(--space-6);
  padding-top: var(--space-5);
  border-top: 1px solid var(--color-separator);
}

.style-panel__reset {
  height: var(--control-h-s);
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--color-accent-text);
  font: inherit;
  font-size: var(--text-s);
  font-weight: var(--weight-medium);
}

.style-panel__reset:hover {
  background: var(--color-accent-fill);
}
</style>
