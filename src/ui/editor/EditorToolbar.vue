<script setup lang="ts">
import type { ToolbarCommand, ToolbarState } from './commands.ts'
import Icon from '../common/Icon.vue'
import type { IconName } from '../common/icons.ts'

/**
 * 正文工具栏：常用格式与插入入口（docs/decisions.md 第 2 节）。
 * 只发出命令名，具体编辑由 commands 中的 ProseMirror 命令完成；
 * 按钮的可用 / 激活状态来自编辑器当前状态（state），不提供时全部可用。
 * 按钮在 mousedown 时阻止默认行为，点击后焦点仍留在编辑器中。
 * context 插槽显示在工具栏右侧，用于与当前选中内容相关的按钮（如图片布局）。
 * 工具栏始终只有一行：窄到放不下两者时，context 按钮出现期间暂时代替格式按钮，正文不会因此上下跳动。
 */
const props = defineProps<{ state?: ToolbarState | null }>()

const emit = defineEmits<{ command: [command: ToolbarCommand] }>()

/** 插入类按钮不是开关，没有按下状态。 */
const INSERTS: ReadonlySet<ToolbarCommand> = new Set(['table', 'image'])

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

/**
 * 按钮内容：粗体 / 斜体用字母，其余用界面的线条图标（ui/common/icons.ts）。
 */
interface ToolbarItem {
  readonly command: ToolbarCommand
  readonly label: string
  readonly title: string
  readonly text?: string
  readonly icon?: IconName
}

const groups: ReadonlyArray<ReadonlyArray<ToolbarItem>> = [
  [
    { command: 'bold', label: '粗体', text: 'B', title: `粗体（${mod}B）` },
    { command: 'italic', label: '斜体', text: 'I', title: `斜体（${mod}I）` },
  ],
  [
    {
      command: 'bullet-list',
      label: '无序列表',
      title: '无序列表',
      icon: 'bullet-list',
    },
    {
      command: 'ordered-list',
      label: '有序列表',
      title: '有序列表',
      icon: 'ordered-list',
    },
    { command: 'quote', label: '引用', title: '引用', icon: 'quote' },
  ],
  [
    { command: 'code-block', label: '代码块', title: '代码块', icon: 'code-block' },
    { command: 'table', label: '表格', title: '插入表格', icon: 'table' },
    {
      command: 'image',
      label: '图片',
      title: '插入图片',
      icon: 'image',
    },
  ],
]
</script>

<template>
  <div
    class="editor-toolbar"
    :class="{ 'editor-toolbar--context': $slots.context }"
    role="toolbar"
    aria-label="正文格式"
  >
    <div v-for="(group, index) in groups" :key="index" class="editor-toolbar__group">
      <button
        v-for="item in group"
        :key="item.command"
        type="button"
        class="editor-toolbar__button"
        :class="[
          `editor-toolbar__button--${item.command}`,
          { 'editor-toolbar__button--active': props.state?.[item.command].active },
        ]"
        :aria-label="item.label"
        :aria-pressed="props.state && !INSERTS.has(item.command) ? props.state[item.command].active : undefined"
        :disabled="props.state ? !props.state[item.command].enabled : false"
        :title="item.title"
        @mousedown.prevent
        @click="emit('command', item.command)"
      >
        <Icon v-if="item.icon" :name="item.icon" />
        <template v-else>{{ item.text }}</template>
      </button>
    </div>
    <div v-if="$slots.context" class="editor-toolbar__context">
      <slot name="context" />
    </div>
  </div>
</template>

<style scoped>
/*
 * 工具栏是一行安静的图标按钮：默认次级前景色，没有边框和底色；
 * hover 出现浅底，当前格式（按下）用强调色的浅底与文字。
 */
.editor-toolbar {
  container-type: inline-size;
  display: flex;
  align-items: center;
  gap: var(--space-5);
  min-width: 0;
}

.editor-toolbar__group {
  display: flex;
  flex: none;
  gap: var(--space-1);
}

.editor-toolbar__context {
  display: flex;
  flex: none;
  margin-left: var(--space-2);
  padding-left: var(--space-5);
  border-left: 1px solid var(--color-separator);
}

/* 格式按钮与图片布局按钮并排需要约 560px；更窄时图片布局按钮出现期间暂时代替格式按钮，工具栏仍只有一行。 */
@container (max-width: 560px) {
  .editor-toolbar--context .editor-toolbar__group {
    display: none;
  }

  .editor-toolbar--context .editor-toolbar__context {
    margin-left: 0;
    padding-left: 0;
    border-left: none;
  }
}

.editor-toolbar__button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: var(--control-h-m);
  height: var(--control-h-m);
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: var(--color-text-secondary);
  font-size: var(--text-l);
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.editor-toolbar__button:hover:not(:disabled) {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.editor-toolbar__button:active:not(:disabled) {
  background: var(--color-fill-pressed);
}

.editor-toolbar__button--active,
.editor-toolbar__button--active:hover:not(:disabled) {
  background: var(--color-accent-fill);
  color: var(--color-accent-text);
}

.editor-toolbar__button:disabled {
  color: var(--color-text-disabled);
}

.editor-toolbar__button--bold {
  font-weight: 700;
}

.editor-toolbar__button--italic {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 15px;
  font-style: italic;
}
</style>
