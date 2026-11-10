<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

/** 警告文案由调用方提供；关闭后由调用方卸载组件。 */
withDefaults(defineProps<{ title: string; warnings: readonly string[]; buttonLabel?: string; description?: string }>(), {
  buttonLabel: '完成',
})
const emit = defineEmits<{ close: [] }>()
const done = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  } else if (event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    done.value?.focus()
  }
}
onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', onKeydown, true)
  await nextTick()
  done.value?.focus()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <div class="warning__scrim">
    <div class="warning" role="dialog" aria-modal="true" aria-labelledby="warning-title" :aria-describedby="description ? 'warning-description warning-list' : 'warning-list'">
      <h2 id="warning-title" class="warning__title">{{ title }}</h2>
      <p v-if="description" id="warning-description" class="warning__description">{{ description }}</p>
      <ul id="warning-list" class="warning__list">
        <li v-for="(warning, index) in warnings" :key="index">{{ warning }}</li>
      </ul>
      <div class="warning__actions">
        <button ref="done" type="button" class="warning__button" @click="emit('close')">{{ buttonLabel }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.warning__scrim { position: fixed; inset: 0; z-index: var(--z-dialog); display: flex; align-items: flex-start; justify-content: center; padding-top: 18vh; background: var(--color-scrim); }
.warning { box-sizing: border-box; width: 420px; max-width: calc(100vw - 2 * var(--space-8)); max-height: 80vh; display: flex; flex-direction: column; padding: var(--space-7) var(--space-7) var(--space-6); border-radius: var(--radius-l); background: var(--color-bg-raised); box-shadow: var(--shadow-dialog); color: var(--color-text); font-size: var(--text-m); line-height: var(--leading-normal); }
.warning__title { margin: 0 0 var(--space-3); font-size: var(--text-l); font-weight: var(--weight-semibold); }
.warning__description { margin: 0 0 var(--space-3); color: var(--color-text-secondary); }
.warning__list { min-height: 0; margin: 0; padding-left: var(--space-7); overflow-y: auto; overflow-wrap: anywhere; color: var(--color-text-secondary); }
.warning__actions { display: flex; justify-content: flex-end; margin-top: var(--space-6); }
.warning__button { min-width: 72px; height: var(--control-h-m); padding: 0 var(--space-5); border: none; border-radius: var(--radius-m); background: var(--color-accent); color: var(--color-text-on-accent); font: inherit; font-weight: var(--weight-medium); }
.warning__button:hover { background: var(--color-accent-hover); }
.warning__button:focus { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
</style>
