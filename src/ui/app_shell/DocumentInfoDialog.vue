<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DocumentInfo } from '../../domain/document/document.ts'

/**
 * 文档信息对话框：标题、副标题、作者。它们属于文档内容，显示在导出的 Word 与 PDF 开头
 * （docs/pdf-layout.md 第 2 节）。
 *
 * - 模态，外观与章节树的删除确认一致。打开时焦点在第一个输入框，关闭后回到打开前的位置。
 * - Enter 完成，Esc 取消，Tab 只在对话框内循环。点击遮罩不关闭：避免误点丢掉已输入的内容。
 * - 完成时去掉首尾空白；标题为空时保留原标题（与重命名一致），副标题与作者为空表示没有。
 */
const props = defineProps<{ info: DocumentInfo }>()

const emit = defineEmits<{
  submit: [info: DocumentInfo]
  cancel: []
}>()

const title = ref(props.info.title)
const subtitle = ref(props.info.subtitle)
const author = ref(props.info.author)
const dialog = ref<HTMLElement | null>(null)
const firstInput = ref<HTMLInputElement | null>(null)
let previousFocus: HTMLElement | null = null

function submit(): void {
  emit('submit', {
    title: title.value.trim() || props.info.title,
    subtitle: subtitle.value.trim(),
    author: author.value.trim(),
  })
}

/**
 * 在 window 的捕获阶段处理 Esc 与 Tab，与删除确认相同：焦点被系统菜单等带出对话框时，
 * 按键也不落到正文、章节树或全局快捷键上，Tab 把焦点带回对话框。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
    return
  }
  if (event.key !== 'Tab') return
  event.preventDefault()
  event.stopPropagation()
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('input, button') ?? [])]
  if (controls.length === 0) return
  const index = controls.indexOf(document.activeElement as HTMLElement)
  const next = index === -1 ? 0 : index + (event.shiftKey ? -1 : 1)
  controls[(next + controls.length) % controls.length].focus()
}

onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', onKeydown, true)
  await nextTick()
  firstInput.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <div class="document-info__scrim">
    <form
      ref="dialog"
      class="document-info"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-info-title"
      aria-describedby="document-info-text"
      @submit.prevent="submit"
    >
      <h2 id="document-info-title" class="document-info__title">文档信息</h2>
      <p id="document-info-text" class="document-info__text">显示在导出的 Word 和 PDF 开头。</p>
      <div class="document-info__fields">
        <label class="document-info__label" for="document-info-name">标题</label>
        <input
          id="document-info-name"
          ref="firstInput"
          v-model="title"
          class="document-info__input"
          type="text"
          spellcheck="false"
          autocomplete="off"
        />
        <label class="document-info__label" for="document-info-subtitle">副标题</label>
        <input
          id="document-info-subtitle"
          v-model="subtitle"
          class="document-info__input"
          type="text"
          placeholder="无"
          spellcheck="false"
          autocomplete="off"
        />
        <label class="document-info__label" for="document-info-author">作者</label>
        <input
          id="document-info-author"
          v-model="author"
          class="document-info__input"
          type="text"
          placeholder="无"
          spellcheck="false"
          autocomplete="off"
        />
      </div>
      <div class="document-info__actions">
        <button type="button" class="document-info__button" @click="emit('cancel')">取消</button>
        <button type="submit" class="document-info__button document-info__button--primary">完成</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.document-info__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 18vh;
  background: var(--color-scrim);
  animation: document-info-fade var(--duration-base) var(--ease-out);
}

@keyframes document-info-fade {
  from {
    opacity: 0;
  }
}

.document-info {
  width: 400px;
  max-width: calc(100vw - 2 * var(--space-8));
  box-sizing: border-box;
  margin: 0;
  padding: var(--space-7) var(--space-7) var(--space-6);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-dialog);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  animation: document-info-in var(--duration-slow) var(--ease-out);
}

@keyframes document-info-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
}

.document-info__title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-l);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-normal);
}

.document-info__text {
  margin: 0 0 var(--space-6);
  color: var(--color-text-secondary);
  -webkit-user-select: none;
  user-select: none;
}

/* 标签右对齐成一列，输入框左边缘对齐。 */
.document-info__fields {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: var(--space-4) var(--space-4);
  margin-bottom: var(--space-7);
}

.document-info__label {
  color: var(--color-text-secondary);
  text-align: right;
  -webkit-user-select: none;
  user-select: none;
}

.document-info__input {
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

.document-info__input::placeholder {
  color: var(--color-text-tertiary);
}

/* 与文档名输入框相同的聚焦样式。 */
.document-info__input:focus {
  box-shadow: 0 0 0 1px var(--color-accent), 0 0 0 3px var(--color-accent-fill-strong);
}

.document-info__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-4);
}

.document-info__button {
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

.document-info__button:hover {
  background: var(--color-fill-pressed);
}

/* 与删除确认相同：焦点所在的按钮总是标出。 */
.document-info__button:focus {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.document-info__button--primary {
  background: var(--color-accent);
  box-shadow: none;
  color: var(--color-text-on-accent);
}

.document-info__button--primary:hover {
  background: var(--color-accent-hover);
}
</style>
