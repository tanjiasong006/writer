<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  PDF_LAYOUT_OPTIONS,
  isDefaultPdfLayout,
  resolvePdfLayout,
  setPdfLayoutOption,
  type PdfLayout,
  type PdfLayoutKey,
  type PdfLayoutSettings,
} from '../../domain/pdf_layout/pdf_layout.ts'
import SegmentedControl from '../common/SegmentedControl.vue'
import PdfLayoutSchematic from './PdfLayoutSchematic.vue'

/**
 * PDF 排版设置（docs/pdf-layout.md 第 4 节）：文档级的少量分档选项，旁边是随设置变化的页面示意。
 *
 * - 修改先作用于草稿：完成（或导出）时提交，取消 / Esc 放弃。"恢复默认"清空全部改动。
 * - action 为 export 时主按钮是"导出…"（从导出 PDF 进入），否则是"完成"（从菜单进入）。
 * - 模态，外观与其他对话框一致：Tab 只在对话框内循环；在选项以外的位置按 Enter 等同主按钮。
 *   打开时焦点在第一个选项，关闭后回到打开前的位置。
 */
const props = defineProps<{
  settings: PdfLayoutSettings
  action: 'export' | 'save'
}>()

const emit = defineEmits<{
  submit: [settings: PdfLayoutSettings]
  cancel: []
}>()

const draft = shallowRef(props.settings)
const layout = computed(() => resolvePdfLayout(draft.value))
const dialog = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null

function set<K extends PdfLayoutKey>(key: K, value: PdfLayout[K]): void {
  draft.value = setPdfLayoutOption(draft.value, key, value)
}

/** 各项取值在界面上的名称；顺序与 PDF_LAYOUT_OPTIONS 相同。 */
const LABELS: { readonly [K in PdfLayoutKey]?: Readonly<Record<string, string>> } = {
  paper: { a4: 'A4', b5: 'B5', a5: 'A5', letter: 'Letter' },
  margin: { narrow: '窄', normal: '标准', wide: '宽' },
  binding: { single: '单面', double: '双面' },
  bodyFont: { serif: '宋体', sans: '黑体' },
  headingFont: { sans: '黑体', serif: '宋体' },
  bodySize: { '10.5': '五号', '12': '小四', '14': '四号' },
  lineHeight: { compact: '紧凑', normal: '标准', loose: '宽松' },
  paragraph: { indent: '首行缩进', spacing: '段间空行' },
  tocDepth: { '1': '1 级', '2': '2 级', '3': '3 级' },
  chapterNumber: { plain: '1', chapter: '第 1 章', none: '不显示' },
  header: { none: '无', title: '标题', titleAndChapter: '标题和章节' },
  pageNumber: { plain: '1', page: '第 1 页', total: '1 / N' },
  table: { threeLine: '三线表', grid: '网格' },
}

function options<K extends PdfLayoutKey>(key: K): { value: PdfLayout[K] & (string | number); label: string }[] {
  return PDF_LAYOUT_OPTIONS[key].map((value) => ({
    value: value as PdfLayout[K] & (string | number),
    label: LABELS[key]?.[String(value)] ?? String(value),
  }))
}

function submit(): void {
  emit('submit', draft.value)
}

/**
 * Esc、Tab 与 Enter 在 window 的捕获阶段处理，与其他对话框相同：焦点被带出对话框时，
 * 按键也不落到正文、章节树或全局快捷键上。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
    return
  }
  if (event.key === 'Enter') {
    // 焦点在按钮上时由按钮自己处理（分段选项、恢复默认、取消）。
    if (document.activeElement instanceof HTMLButtonElement) return
    event.preventDefault()
    event.stopPropagation()
    submit()
    return
  }
  if (event.key !== 'Tab') return
  event.preventDefault()
  event.stopPropagation()
  const controls = [
    ...(dialog.value?.querySelectorAll<HTMLElement>('input:not(:disabled), button[tabindex="0"]:not(:disabled), button:not([tabindex]):not(:disabled)') ?? []),
  ]
  if (controls.length === 0) return
  const index = controls.indexOf(document.activeElement as HTMLElement)
  const next = index === -1 ? 0 : index + (event.shiftKey ? -1 : 1)
  controls[(next + controls.length) % controls.length].focus()
}

onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', onKeydown, true)
  await nextTick()
  dialog.value?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <div class="pdf-layout__scrim">
    <div
      ref="dialog"
      class="pdf-layout"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-layout-title"
      aria-describedby="pdf-layout-text"
    >
      <h2 id="pdf-layout-title" class="pdf-layout__title">PDF 排版</h2>
      <p id="pdf-layout-text" class="pdf-layout__text">随文档保存，每次导出 PDF 时使用。</p>

      <div class="pdf-layout__body">
        <PdfLayoutSchematic class="pdf-layout__schematic" :layout="layout" />

        <div class="pdf-layout__options">
          <section class="pdf-layout__group" aria-labelledby="pdf-layout-page">
            <h3 id="pdf-layout-page" class="pdf-layout__group-title">页面</h3>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">纸张</span>
              <SegmentedControl
                label="纸张"
                :model-value="layout.paper"
                :options="options('paper')"
                @update:model-value="set('paper', $event)"
              />
            </div>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">页边距</span>
              <SegmentedControl
                label="页边距"
                :model-value="layout.margin"
                :options="options('margin')"
                @update:model-value="set('margin', $event)"
              />
            </div>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">装订</span>
              <SegmentedControl
                label="装订"
                :model-value="layout.binding"
                :options="options('binding')"
                @update:model-value="set('binding', $event)"
              />
            </div>
          </section>

          <section class="pdf-layout__group" aria-labelledby="pdf-layout-text-group">
            <h3 id="pdf-layout-text-group" class="pdf-layout__group-title">文字</h3>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">正文</span>
              <SegmentedControl
                label="正文字体"
                :model-value="layout.bodyFont"
                :options="options('bodyFont')"
                @update:model-value="set('bodyFont', $event)"
              />
              <SegmentedControl
                label="正文字号"
                :model-value="layout.bodySize"
                :options="options('bodySize')"
                @update:model-value="set('bodySize', $event)"
              />
            </div>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">标题</span>
              <SegmentedControl
                label="标题字体"
                :model-value="layout.headingFont"
                :options="options('headingFont')"
                @update:model-value="set('headingFont', $event)"
              />
            </div>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">行距</span>
              <SegmentedControl
                label="行距"
                :model-value="layout.lineHeight"
                :options="options('lineHeight')"
                @update:model-value="set('lineHeight', $event)"
              />
            </div>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">段落</span>
              <SegmentedControl
                label="段落"
                :model-value="layout.paragraph"
                :options="options('paragraph')"
                @update:model-value="set('paragraph', $event)"
              />
            </div>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">表格</span>
              <SegmentedControl
                label="表格"
                :model-value="layout.table"
                :options="options('table')"
                @update:model-value="set('table', $event)"
              />
            </div>
          </section>

          <section class="pdf-layout__group" aria-labelledby="pdf-layout-structure">
            <h3 id="pdf-layout-structure" class="pdf-layout__group-title">结构</h3>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label" />
              <label class="pdf-layout__check">
                <input
                  type="checkbox"
                  :checked="layout.cover"
                  @change="set('cover', ($event.target as HTMLInputElement).checked)"
                />
                封面
              </label>
              <label class="pdf-layout__check pdf-layout__check--next">
                <input
                  type="checkbox"
                  :checked="layout.toc"
                  @change="set('toc', ($event.target as HTMLInputElement).checked)"
                />
                目录
              </label>
              <SegmentedControl
                label="目录层级"
                :model-value="layout.tocDepth"
                :options="options('tocDepth')"
                :disabled="!layout.toc"
                @update:model-value="set('tocDepth', $event)"
              />
            </div>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label" />
              <label class="pdf-layout__check">
                <input
                  type="checkbox"
                  :checked="layout.chapterNewPage"
                  @change="set('chapterNewPage', ($event.target as HTMLInputElement).checked)"
                />
                一级章节另起一页
              </label>
            </div>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">章节编号</span>
              <SegmentedControl
                label="章节编号"
                :model-value="layout.chapterNumber"
                :options="options('chapterNumber')"
                @update:model-value="set('chapterNumber', $event)"
              />
            </div>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">页眉</span>
              <SegmentedControl
                label="页眉"
                :model-value="layout.header"
                :options="options('header')"
                @update:model-value="set('header', $event)"
              />
            </div>
            <div class="pdf-layout__row">
              <span class="pdf-layout__label">页码</span>
              <SegmentedControl
                label="页码"
                :model-value="layout.pageNumber"
                :options="options('pageNumber')"
                @update:model-value="set('pageNumber', $event)"
              />
            </div>
          </section>
        </div>
      </div>

      <div class="pdf-layout__actions">
        <button
          type="button"
          class="pdf-layout__button pdf-layout__reset"
          :disabled="isDefaultPdfLayout(draft)"
          @click="draft = {}"
        >
          恢复默认
        </button>
        <button type="button" class="pdf-layout__button" @click="emit('cancel')">取消</button>
        <button type="button" class="pdf-layout__button pdf-layout__button--primary" @click="submit">
          {{ action === 'export' ? '导出…' : '完成' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-layout__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 6vh var(--space-8) var(--space-8);
  background: var(--color-scrim);
  animation: pdf-layout-fade var(--duration-base) var(--ease-out);
}

@keyframes pdf-layout-fade {
  from {
    opacity: 0;
  }
}

.pdf-layout {
  display: flex;
  flex-direction: column;
  width: 640px;
  max-width: 100%;
  max-height: 100%;
  box-sizing: border-box;
  padding: var(--space-7) var(--space-7) var(--space-6);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-dialog);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  -webkit-user-select: none;
  user-select: none;
  animation: pdf-layout-in var(--duration-slow) var(--ease-out);
}

@keyframes pdf-layout-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
}

.pdf-layout__title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-l);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-normal);
}

.pdf-layout__text {
  margin: 0 0 var(--space-6);
  color: var(--color-text-secondary);
}

/* 示意在左，选项在右；窗口较矮时只有选项滚动，示意保持可见。 */
.pdf-layout__body {
  display: flex;
  gap: var(--space-8);
  min-height: 0;
  margin-bottom: var(--space-7);
}

.pdf-layout__schematic {
  flex: none;
  width: 184px;
  padding-top: var(--space-6);
}

.pdf-layout__options {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}

.pdf-layout__group + .pdf-layout__group {
  margin-top: var(--space-6);
}

.pdf-layout__group-title {
  margin: 0 0 var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--text-s);
  font-weight: var(--weight-semibold);
}

/* 标签固定宽度、右对齐，控件左边缘对齐成一列。 */
.pdf-layout__row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: var(--control-h-m);
}

.pdf-layout__row + .pdf-layout__row {
  margin-top: var(--space-1);
}

.pdf-layout__label {
  flex: none;
  width: 56px;
  color: var(--color-text-secondary);
  text-align: right;
}

.pdf-layout__check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text);
}

/* 同一行的第二个复选框与前一组隔开。 */
.pdf-layout__check--next {
  margin-left: var(--space-6);
}

.pdf-layout__check input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--color-accent);
}

.pdf-layout__check input:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.pdf-layout__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-4);
}

/* 恢复默认放在左侧，与提交 / 取消分开。 */
.pdf-layout__reset {
  margin-right: auto;
}

.pdf-layout__button {
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

.pdf-layout__button:hover:not(:disabled) {
  background: var(--color-fill-pressed);
}

.pdf-layout__button:disabled {
  color: var(--color-text-disabled);
}

/* 与其他对话框相同：焦点所在的按钮总是标出。 */
.pdf-layout__button:focus {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.pdf-layout__button--primary {
  background: var(--color-accent);
  box-shadow: none;
  color: var(--color-text-on-accent);
}

.pdf-layout__button--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}
</style>
