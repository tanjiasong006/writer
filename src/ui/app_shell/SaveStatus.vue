<script setup lang="ts">
import { computed } from 'vue'
import type { SaveStatus } from '../../application/project_session.ts'
import type { StorageFailure } from '../../application/project_storage.ts'
import { messageForStorageFailure } from './storage_messages.ts'

/**
 * 保存状态指示：已保存 / 未保存 / 正在保存 / 保存失败（可重试）。一行，放在工具栏的文档名旁；
 * 失败原因在指针停留时显示（工作区同时以提示条给出完整原因）。
 * 自动保存正常工作时工作区不显示它：和 macOS 的自动存储一样，不让"已保存 / 未保存"在写作时反复闪动。
 */
const props = defineProps<{
  status: SaveStatus
  error: StorageFailure | null
}>()

const emit = defineEmits<{ retry: [] }>()

const label = computed(() => {
  switch (props.status) {
    case 'saved':
      return '已保存'
    case 'dirty':
      return '未保存'
    case 'saving':
      return '正在保存…'
    case 'failed':
      return '保存失败'
  }
})

const detail = computed(() =>
  props.status === 'failed' && props.error ? messageForStorageFailure(props.error) : null,
)
</script>

<template>
  <div class="save-status" :class="`save-status--${status}`" role="status">
    <span class="save-status__label" :title="detail ?? undefined">{{ label }}</span>
    <button v-if="status === 'failed'" type="button" class="save-status__retry" @click="emit('retry')">
      重试
    </button>
  </div>
</template>

<style scoped>
.save-status {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  height: var(--control-h-s);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  white-space: nowrap;
}

.save-status--failed {
  color: var(--color-danger-text);
  font-weight: var(--weight-medium);
}

.save-status__label {
  flex: none;
}

.save-status__retry {
  flex: none;
  height: var(--control-h-s);
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--color-accent-text);
  font: inherit;
  font-weight: var(--weight-medium);
}

.save-status__retry:hover {
  background: var(--color-accent-fill);
}

.save-status__retry:active {
  background: var(--color-accent-fill-strong);
}
</style>
