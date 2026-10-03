<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 其他程序修改了已打开的文档，且与 Writer 中尚未保存的修改冲突（或结构被修改）时询问用户。
 * “保留 Writer 中的版本”之后保存时覆盖磁盘；“使用磁盘上的版本”放弃 Writer 中对这些内容的修改。
 * 模态，焦点在“保留 Writer 中的版本”（不丢失正在写的内容）；Esc 等同于保留。
 */
defineProps<{
  /** Writer 中也有修改的章节名称。 */
  chapters: readonly string[]
  /** 章节结构、标题、文档信息等被修改。 */
  structure: boolean
}>()

const emit = defineEmits<{
  keep: []
  disk: []
}>()

const dialog = ref<HTMLElement | null>(null)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('keep')
    return
  }
  if (event.key !== 'Tab') return
  event.preventDefault()
  event.stopPropagation()
  const buttons = [...(dialog.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = index === -1 ? 0 : index + (event.shiftKey ? -1 : 1)
  buttons[(next + buttons.length) % buttons.length]?.focus()
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown, true)
  await nextTick()
  dialog.value?.querySelector<HTMLButtonElement>('.external__button--primary')?.focus()
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="external__scrim">
    <div ref="dialog" class="external" role="alertdialog" aria-modal="true" aria-labelledby="external-title" aria-describedby="external-text">
      <h2 id="external-title" class="external__title">其他程序修改了这份文档</h2>
      <div id="external-text" class="external__text">
        <p v-if="structure">章节结构、标题或文档设置在 Writer 之外被修改了。</p>
        <p v-if="chapters.length > 0">以下章节在 Writer 之外被修改，Writer 中也有尚未保存的修改：</p>
        <ul v-if="chapters.length > 0" class="external__chapters">
          <li v-for="name in chapters" :key="name">{{ name }}</li>
        </ul>
        <p class="external__hint">保留 Writer 中的版本会在保存时覆盖其他程序的修改；使用磁盘上的版本会放弃 Writer 中{{ structure ? '尚未保存' : '对这些章节' }}的修改。</p>
      </div>
      <div class="external__actions">
        <button type="button" class="external__button" @click="emit('disk')">使用磁盘上的版本</button>
        <button type="button" class="external__button external__button--primary" @click="emit('keep')">保留 Writer 中的版本</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.external__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 18vh;
  background: var(--color-scrim);
  animation: external-fade var(--duration-base) var(--ease-out);
}

@keyframes external-fade {
  from {
    opacity: 0;
  }
}

.external {
  width: 420px;
  max-width: calc(100vw - 2 * var(--space-8));
  box-sizing: border-box;
  padding: var(--space-7) var(--space-7) var(--space-6);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-dialog);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
}

.external__title {
  margin: 0 0 var(--space-3);
  font-size: var(--text-l);
  font-weight: var(--weight-semibold);
}

.external__text {
  color: var(--color-text-secondary);
}

.external__text p {
  margin: 0 0 var(--space-3);
}

.external__chapters {
  max-height: 160px;
  margin: 0 0 var(--space-4);
  padding-left: var(--space-7);
  overflow-y: auto;
  color: var(--color-text);
}

.external__hint {
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  line-height: var(--leading-tight);
}

.external__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-4);
  margin-top: var(--space-6);
}

.external__button {
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

.external__button:hover {
  background: var(--color-fill-pressed);
}

.external__button:focus {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.external__button--primary {
  background: var(--color-accent);
  box-shadow: none;
  color: var(--color-text-on-accent);
}

.external__button--primary:hover {
  background: var(--color-accent-hover);
}
</style>
