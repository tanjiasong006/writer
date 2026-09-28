<script setup lang="ts">
import Icon from './Icon.vue'

/**
 * 浮在界面之上的提示（导出完成、操作失败、打开时的说明）。不占据布局，出现与消失不会让正文移动。
 * 位置由外层的提示区域决定；错误用 alert 立即读出，其余用 status。
 */
defineProps<{ tone?: 'info' | 'error' }>()

const emit = defineEmits<{ dismiss: [] }>()
</script>

<template>
  <div class="toast" :class="{ 'toast--error': tone === 'error' }" :role="tone === 'error' ? 'alert' : 'status'">
    <span class="toast__message"><slot /></span>
    <span v-if="$slots.actions" class="toast__actions"><slot name="actions" /></span>
    <button type="button" class="toast__dismiss" tabindex="0" aria-label="关闭提示" @click="emit('dismiss')">
      <Icon name="close" />
    </button>
  </div>
</template>

<style scoped>
.toast {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  max-width: min(520px, calc(100vw - 2 * var(--space-6)));
  min-height: 36px;
  box-sizing: border-box;
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-popover);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  pointer-events: auto;
  animation: toast-in var(--duration-slow) var(--ease-out);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

.toast--error .toast__message {
  color: var(--color-danger-text);
}

.toast__message {
  flex: 1;
  min-width: 0;
}

.toast__actions {
  display: flex;
  flex: none;
  gap: var(--space-2);
}

/* 提示中的操作是文字按钮（如"在文件夹中显示"）。 */
.toast__actions :deep(button) {
  height: var(--control-h-s);
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--color-accent-text);
  font: inherit;
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.toast__actions :deep(button:hover) {
  background: var(--color-accent-fill);
}

.toast__dismiss {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--control-h-s);
  height: var(--control-h-s);
  padding: 0;
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
}

.toast__dismiss .icon {
  width: var(--icon-s);
  height: var(--icon-s);
}

.toast__dismiss:hover {
  background: var(--color-fill-hover);
  color: var(--color-text-secondary);
}
</style>
