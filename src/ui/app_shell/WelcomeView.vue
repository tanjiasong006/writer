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

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'
</script>

<template>
  <div class="welcome">
    <div class="welcome__content">
      <h1 class="welcome__title">Writer</h1>
      <p class="welcome__subtitle">专注长文档的组织、写作与输出。</p>
      <div class="welcome__actions">
        <button type="button" class="welcome__button welcome__button--primary" tabindex="0" :disabled="busy" @click="emit('new-project')">
          <span>新建文档</span>
          <kbd class="welcome__shortcut">{{ mod }}N</kbd>
        </button>
        <button type="button" class="welcome__button" tabindex="0" :disabled="busy" @click="emit('open-project')">
          <span>打开文档</span>
          <kbd class="welcome__shortcut">{{ mod }}O</kbd>
        </button>
      </div>
      <p class="welcome__hint">每个文档保存为一个文件夹，打开时选择该文件夹即可。</p>
      <p v-if="error" class="welcome__error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  padding: 0 var(--space-6);
  box-sizing: border-box;
  background: var(--color-bg-sidebar);
  -webkit-user-select: none;
  user-select: none;
}

/* 视觉重心略高于窗口正中。 */
.welcome__content {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 320px;
  margin-bottom: 8vh;
}

.welcome__title {
  margin: 0;
  color: var(--color-text);
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  line-height: 28px;
}

.welcome__subtitle {
  margin: var(--space-1) 0 var(--space-8);
  color: var(--color-text-secondary);
  font-size: var(--text-m);
}

.welcome__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.welcome__button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--control-h-l);
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-bg);
  box-shadow: inset 0 0 0 1px var(--color-separator), 0 1px 1px rgba(0, 0, 0, 0.03);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-m);
  font-weight: var(--weight-medium);
  transition: background-color var(--duration-fast) var(--ease-out);
}

.welcome__button:hover:not(:disabled) {
  box-shadow: inset 0 0 0 1px var(--color-separator-strong), 0 1px 1px rgba(0, 0, 0, 0.03);
}

.welcome__button:active:not(:disabled) {
  background: var(--color-fill-hover);
}

.welcome__button--primary {
  background: var(--color-accent);
  box-shadow: none;
  color: var(--color-text-on-accent);
}

.welcome__button--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.welcome__button--primary:active:not(:disabled) {
  background: var(--color-accent-hover);
}

.welcome__button:disabled {
  opacity: 0.55;
}

.welcome__shortcut {
  color: inherit;
  font-family: inherit;
  font-size: var(--text-s);
  font-weight: 400;
  opacity: 0.6;
}

.welcome__hint {
  margin: var(--space-6) 0 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  line-height: var(--leading-tight);
}

.welcome__error {
  margin: var(--space-6) 0 0;
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-m);
  background: var(--color-danger-fill);
  color: var(--color-danger-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  -webkit-user-select: text;
  user-select: text;
}
</style>
