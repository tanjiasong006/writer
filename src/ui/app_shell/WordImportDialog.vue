<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

/** 路径由上层通过系统选择器提供；组件不执行文件操作。 */
const props = withDefaults(defineProps<{
  filePath: string
  projectName: string
  targetDirectory: string
  busy?: boolean
  error?: string
}>(), { busy: false, error: '' })
const emit = defineEmits<{
  'choose-file': []
  'choose-directory': []
  'update:projectName': [value: string]
  submit: [value: { filePath: string; projectName: string; targetDirectory: string }]
  cancel: []
}>()
const dialog = ref<HTMLElement | null>(null)
const firstButton = ref<HTMLButtonElement | null>(null)
const canSubmit = computed(() => !props.busy && !!props.filePath.trim() && !!props.projectName.trim() && !!props.targetDirectory.trim())
let previousFocus: HTMLElement | null = null

function submit(): void {
  if (canSubmit.value) emit('submit', { filePath: props.filePath, projectName: props.projectName.trim(), targetDirectory: props.targetDirectory })
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (!props.busy) emit('cancel')
  } else if (event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
    if (!controls.length) return
    const index = controls.indexOf(document.activeElement as HTMLElement)
    const next = index === -1 ? (event.shiftKey ? controls.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
    controls[next].focus()
  }
}
onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', onKeydown, true)
  await nextTick()
  firstButton.value?.focus()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <div class="word-import__scrim">
    <form ref="dialog" class="word-import" role="dialog" aria-modal="true" aria-labelledby="word-import-title" :aria-busy="busy" @submit.prevent="submit">
      <h2 id="word-import-title" class="word-import__title">导入 Word 文档</h2>
      <p class="word-import__text">选择 Word 文件，创建一个新项目。</p>
      <div class="word-import__fields">
        <span id="word-import-file-label" class="word-import__label">Word 文件</span>
        <div class="word-import__choice">
          <span class="word-import__path" :title="filePath">{{ filePath || '未选择文件' }}</span>
          <button ref="firstButton" type="button" class="word-import__button" :disabled="busy" aria-labelledby="word-import-file-label word-import-file-button" @click="emit('choose-file')"><span id="word-import-file-button">选择…</span></button>
        </div>
        <label for="word-import-name" class="word-import__label">项目名</label>
        <input id="word-import-name" class="word-import__input" type="text" :value="projectName" :disabled="busy" autocomplete="off" @input="emit('update:projectName', ($event.target as HTMLInputElement).value)" />
        <span id="word-import-directory-label" class="word-import__label">目标目录</span>
        <div class="word-import__choice">
          <span class="word-import__path" :title="targetDirectory">{{ targetDirectory || '未选择目录' }}</span>
          <button type="button" class="word-import__button" :disabled="busy" aria-labelledby="word-import-directory-label word-import-directory-button" @click="emit('choose-directory')"><span id="word-import-directory-button">选择…</span></button>
        </div>
      </div>
      <p v-if="error" class="word-import__error" role="alert">{{ error }}</p>
      <div class="word-import__actions">
        <button type="button" class="word-import__button" :disabled="busy" @click="emit('cancel')">取消</button>
        <button type="submit" class="word-import__button word-import__button--primary" :disabled="!canSubmit">{{ busy ? '正在导入…' : '导入' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.word-import__scrim { position: fixed; inset: 0; z-index: var(--z-dialog); display: flex; justify-content: center; align-items: flex-start; padding-top: 18vh; background: var(--color-scrim); }
.word-import { box-sizing: border-box; width: 420px; max-width: calc(100vw - 2 * var(--space-8)); max-height: 80vh; overflow-y: auto; margin: 0; padding: var(--space-7) var(--space-7) var(--space-6); border-radius: var(--radius-l); background: var(--color-bg-raised); box-shadow: var(--shadow-dialog); color: var(--color-text); font-size: var(--text-m); line-height: var(--leading-normal); }
.word-import__title { margin: 0 0 var(--space-2); font-size: var(--text-l); font-weight: var(--weight-semibold); }
.word-import__text { margin: 0 0 var(--space-6); color: var(--color-text-secondary); }
.word-import__fields { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--space-4); }
.word-import__label { color: var(--color-text-secondary); text-align: right; }
.word-import__choice { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.word-import__path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.word-import__input { box-sizing: border-box; width: 100%; min-width: 0; height: var(--control-h-m); padding: 0 var(--space-3); border: none; border-radius: var(--radius-m); background: var(--color-bg); box-shadow: inset 0 0 0 1px var(--color-separator); color: var(--color-text); font: inherit; outline: none; }
.word-import__input:focus { box-shadow: 0 0 0 1px var(--color-accent), 0 0 0 3px var(--color-accent-fill-strong); }
.word-import__error { margin: var(--space-4) 0 0; color: var(--color-danger); overflow-wrap: anywhere; }
.word-import__actions { display: flex; justify-content: flex-end; gap: var(--space-4); margin-top: var(--space-7); }
.word-import__button { flex: none; height: var(--control-h-m); padding: 0 var(--space-5); border: none; border-radius: var(--radius-m); background: var(--color-fill-hover); box-shadow: inset 0 0 0 1px var(--color-separator); color: var(--color-text); font: inherit; font-weight: var(--weight-medium); }
.word-import__button:hover:not(:disabled) { background: var(--color-fill-pressed); }
.word-import__button:focus { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
.word-import__button--primary { min-width: 72px; background: var(--color-accent); box-shadow: none; color: var(--color-text-on-accent); }
.word-import__button--primary:hover:not(:disabled) { background: var(--color-accent-hover); }
.word-import__button:disabled, .word-import__input:disabled { opacity: 0.5; }
</style>
