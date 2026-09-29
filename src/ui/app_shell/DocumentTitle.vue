<script setup lang="ts">
import { nextTick, ref } from 'vue'
import Icon from '../common/Icon.vue'

/**
 * 工具栏开头的文档名（相当于 macOS 窗口的标题）。
 *
 * - 平时是一段安静的标题文字；指针经过时出现浅底与向下的箭头，点击打开文档菜单（重命名、新建、打开、在访达中显示），
 *   与 macOS 点击窗口标题的习惯一致。
 * - 重命名在原处进行：标题变成输入框，Enter / 失焦确认，Esc 放弃；空标题视为放弃。结束后焦点回到标题按钮。
 */
const props = defineProps<{ title: string }>()

const emit = defineEmits<{
  /** 打开文档菜单；rect 是标题按钮的位置，keyboard 表示由键盘触发。 */
  menu: [rect: DOMRect, keyboard: boolean]
  rename: [title: string]
}>()

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
let done = false

async function startRename(): Promise<void> {
  draft.value = props.title
  editing.value = true
  done = false
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

async function finish(submit: boolean, restoreFocus: boolean): Promise<void> {
  if (done) return
  done = true
  const title = draft.value.trim()
  if (submit && title.length > 0 && title !== props.title) emit('rename', title)
  editing.value = false
  if (!restoreFocus) return
  await nextTick()
  button.value?.focus()
}

function openMenu(event: MouseEvent): void {
  emit('menu', (event.currentTarget as HTMLElement).getBoundingClientRect(), event.detail === 0)
}

defineExpose({ startRename })
</script>

<template>
  <div class="document-title">
    <input
      v-if="editing"
      ref="input"
      v-model="draft"
      class="document-title__input"
      type="text"
      aria-label="文档名称"
      spellcheck="false"
      autocomplete="off"
      @keydown.enter.prevent="finish(true, true)"
      @keydown.esc.prevent.stop="finish(false, true)"
      @blur="finish(true, false)"
    />
    <button
      v-else
      ref="button"
      type="button"
      class="document-title__button"
      tabindex="0"
      aria-haspopup="menu"
      :title="title"
      @click="openMenu"
    >
      <span class="document-title__text">{{ title || '未命名文档' }}</span>
      <Icon class="document-title__chevron" name="chevron-down" />
    </button>
  </div>
</template>

<style scoped>
.document-title {
  display: flex;
  min-width: 0;
}

/* 标题与输入框占同样的位置，进入重命名时文字不移动。 */
.document-title__button,
.document-title__input {
  box-sizing: border-box;
  height: var(--control-h-m);
  margin: 0;
  border: none;
  border-radius: var(--radius-m);
  font: inherit;
  font-size: var(--text-l);
  font-weight: var(--weight-semibold);
}

.document-title__button {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  padding: 0 var(--space-2) 0 var(--space-3);
  background: none;
  color: var(--color-text);
  transition: background-color var(--duration-fast) var(--ease-out);
}

.document-title__button:hover,
.document-title__button[aria-expanded='true'] {
  background: var(--color-fill-hover);
}

.document-title__button:active {
  background: var(--color-fill-pressed);
}

.document-title__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 箭头只在指针经过或键盘聚焦时出现：标题平时就是一段文字。 */
.document-title__chevron {
  width: var(--icon-s);
  height: var(--icon-s);
  color: var(--color-text-tertiary);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.document-title__button:hover .document-title__chevron,
.document-title__button:focus-visible .document-title__chevron {
  opacity: 1;
}

.document-title__input {
  width: 280px;
  max-width: 100%;
  padding: 0 var(--space-3);
  background: var(--color-bg);
  box-shadow: 0 0 0 1px var(--color-accent), 0 0 0 3px var(--color-accent-fill-strong);
  color: var(--color-text);
  outline: none;
}
</style>
