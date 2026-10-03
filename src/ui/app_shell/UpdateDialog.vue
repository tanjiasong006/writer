<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { UpdateState } from './use_updates.ts'

/**
 * 检查更新的对话框：检查中、已是最新、未配置、失败、发现新版本（说明）、下载安装中、已安装（重新启动）。
 * 模态，Esc 与“好 / 稍后”关闭（下载安装中不能关闭）；主要按钮获得焦点。只发出事件，不执行更新。
 */
const props = defineProps<{
  state: UpdateState
  appName: string
}>()

const emit = defineEmits<{
  install: []
  restart: []
  close: []
}>()

const dialog = ref<HTMLElement | null>(null)

const title = computed(() => {
  switch (props.state.kind) {
    case 'checking':
      return '正在检查更新…'
    case 'not-configured':
      return '此版本不检查更新'
    case 'up-to-date':
      return `${props.appName} 已是最新版本`
    case 'failed':
      return '无法检查更新'
    case 'available':
      return `${props.appName} ${props.state.version} 可以更新`
    case 'installing':
      return `正在下载并安装 ${props.state.version}…`
    case 'installed':
      return '更新已安装'
    case 'install-failed':
      return '更新没有安装成功'
  }
  return ''
})

const text = computed(() => {
  switch (props.state.kind) {
    case 'checking':
      return '正在连接更新服务器。'
    case 'not-configured':
      return '开发版或自行编译的版本没有配置自动更新，请从发布页面获取新版本。'
    case 'up-to-date':
      return `当前版本 ${props.state.current}。`
    case 'failed':
      return '请检查网络连接后再试。'
    case 'available':
      return `当前版本 ${props.state.current}。下载并安装后，重新启动即可使用新版本；打开的文档会先保存。`
    case 'installing':
      return '请稍候，不要退出应用。'
    case 'installed':
      return `重新启动 ${props.appName} 后生效。打开的文档会先保存。`
    case 'install-failed':
      return '当前版本没有变化，可以稍后再试。'
  }
  return ''
})

/** 原始错误：只作为补充，以次要文字显示。 */
const detail = computed(() =>
  props.state.kind === 'failed' || props.state.kind === 'install-failed' ? props.state.message : null,
)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  event.preventDefault()
  event.stopPropagation()
  const buttons = [...(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  if (buttons.length === 0) return
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = index === -1 ? 0 : index + (event.shiftKey ? -1 : 1)
  buttons[(next + buttons.length) % buttons.length].focus()
}

async function focusPrimary(): Promise<void> {
  await nextTick()
  dialog.value?.querySelector<HTMLButtonElement>('.update-dialog__button--primary, .update-dialog__button')?.focus()
}

let previousFocus: HTMLElement | null = null

onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', onKeydown, true)
  void focusPrimary()
})

watch(() => props.state.kind, () => void focusPrimary())

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <div class="update-dialog__scrim">
    <div
      ref="dialog"
      class="update-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
      aria-describedby="update-dialog-text"
      :aria-busy="state.kind === 'checking' || state.kind === 'installing'"
    >
      <h2 id="update-dialog-title" class="update-dialog__title">{{ title }}</h2>
      <p id="update-dialog-text" class="update-dialog__text">{{ text }}</p>
      <p v-if="detail" class="update-dialog__detail">{{ detail }}</p>
      <div v-if="state.kind === 'available' && state.notes" class="update-dialog__notes" tabindex="0" aria-label="更新说明">
        {{ state.notes }}
      </div>
      <div class="update-dialog__actions">
        <template v-if="state.kind === 'available'">
          <button type="button" class="update-dialog__button" @click="emit('close')">稍后</button>
          <button type="button" class="update-dialog__button update-dialog__button--primary" @click="emit('install')">
            下载并安装
          </button>
        </template>
        <template v-else-if="state.kind === 'installed'">
          <button type="button" class="update-dialog__button" @click="emit('close')">稍后</button>
          <button type="button" class="update-dialog__button update-dialog__button--primary" @click="emit('restart')">
            重新启动
          </button>
        </template>
        <button v-else-if="state.kind === 'checking'" type="button" class="update-dialog__button" @click="emit('close')">
          取消
        </button>
        <button v-else-if="state.kind === 'installing'" type="button" class="update-dialog__button" disabled>
          正在安装…
        </button>
        <button v-else type="button" class="update-dialog__button update-dialog__button--primary" @click="emit('close')">
          好
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 与文档信息、删除确认相同的模态对话框。 */
.update-dialog__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 18vh;
  background: var(--color-scrim);
  animation: update-dialog-fade var(--duration-base) var(--ease-out);
}

@keyframes update-dialog-fade {
  from {
    opacity: 0;
  }
}

.update-dialog {
  width: 380px;
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

.update-dialog__title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-l);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-normal);
}

.update-dialog__text {
  margin: 0 0 var(--space-6);
  color: var(--color-text-secondary);
}

.update-dialog__detail {
  margin: calc(-1 * var(--space-4)) 0 var(--space-6);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  line-height: var(--leading-tight);
  overflow-wrap: anywhere;
}

/* 更新说明：较长时在框内滚动，不撑高对话框。 */
.update-dialog__notes {
  max-height: 180px;
  margin: 0 0 var(--space-6);
  padding: var(--space-4) var(--space-5);
  overflow-y: auto;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  white-space: pre-wrap;
  -webkit-user-select: text;
  user-select: text;
}

.update-dialog__notes:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.update-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-4);
}

.update-dialog__button {
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

.update-dialog__button:hover:not(:disabled) {
  background: var(--color-fill-pressed);
}

.update-dialog__button:disabled {
  color: var(--color-text-disabled);
}

.update-dialog__button:focus {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.update-dialog__button--primary {
  background: var(--color-accent);
  box-shadow: none;
  color: var(--color-text-on-accent);
}

.update-dialog__button--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}
</style>
