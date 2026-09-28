<script setup lang="ts">
/** 没有打开项目时的欢迎页：新建或打开文档。 */
defineProps<{
  /** 上一次操作的错误说明（如打开失败）。 */
  error?: string | null
  /** 正在新建或打开时禁用按钮，避免重复操作。 */
  busy?: boolean
}>()

const emit = defineEmits<{
  'new-project': []
  'open-project': []
}>()
</script>

<template>
  <div class="welcome">
    <h1 class="welcome__title">Writer</h1>
    <p class="welcome__subtitle">专注长文档的组织、写作与输出。</p>
    <div class="welcome__actions">
      <button type="button" class="welcome__primary" :disabled="busy" @click="emit('new-project')">
        新建文档
      </button>
      <button type="button" :disabled="busy" @click="emit('open-project')">打开文档</button>
    </div>
    <p v-if="error" class="welcome__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100vh;
  padding: 0 16px;
  text-align: center;
}

.welcome__title {
  margin: 0;
  font-size: 28px;
}

.welcome__subtitle {
  margin: 0;
  color: #6b7280;
}

.welcome__actions {
  display: flex;
  gap: 12px;
  margin-top: 12px;
}

.welcome__actions button {
  padding: 8px 18px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}

.welcome__actions .welcome__primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #ffffff;
}

.welcome__actions button:disabled {
  opacity: 0.6;
  cursor: default;
}

.welcome__error {
  max-width: 32rem;
  color: #b91c1c;
}
</style>
