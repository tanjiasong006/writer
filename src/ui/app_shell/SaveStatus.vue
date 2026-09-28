<script setup lang="ts">
import { computed } from 'vue'
import type { SaveStatus } from '../../application/project_session.ts'
import type { StorageFailure } from '../../application/project_storage.ts'
import { messageForStorageFailure } from './storage_messages.ts'

/** 保存状态指示：已保存 / 未保存 / 正在保存 / 保存失败（可重试）。 */
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
    <span v-if="detail" class="save-status__detail" :title="detail">{{ detail }}</span>
    <button v-if="status === 'failed'" type="button" class="save-status__retry" @click="emit('retry')">
      重试
    </button>
  </div>
</template>

<style scoped>
/* 次级信息：平时只是一行很弱的文字，失败时变为危险色并提供重试。 */
.save-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--space-3);
  min-width: 0;
  min-height: var(--control-h-s);
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
}

.save-status--failed {
  color: var(--color-danger-text);
}

.save-status__label {
  flex: none;
  white-space: nowrap;
}

/* 失败原因是用户需要据此处理的信息：完整显示在状态下面一行，不截断。 */
.save-status__detail {
  order: 3;
  flex-basis: 100%;
  padding-bottom: var(--space-2);
  line-height: var(--leading-tight);
  -webkit-user-select: text;
  user-select: text;
}

.save-status__retry {
  flex: none;
  height: var(--control-h-s);
  margin-left: auto;
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
</style>
