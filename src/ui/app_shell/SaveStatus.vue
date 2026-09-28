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
    <span v-if="detail" class="save-status__detail">{{ detail }}</span>
    <button v-if="status === 'failed'" type="button" class="save-status__retry" @click="emit('retry')">
      重试
    </button>
  </div>
</template>

<style scoped>
.save-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  color: #6b7280;
}

.save-status--failed {
  color: #b91c1c;
}

.save-status__detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.save-status__retry {
  flex: none;
  padding: 2px 8px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: none;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
</style>
