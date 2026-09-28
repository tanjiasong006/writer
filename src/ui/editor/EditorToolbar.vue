<script setup lang="ts">
import type { ToolbarCommand, ToolbarState } from './commands.ts'

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
 * 按钮内容：粗体 / 斜体用字母，其余用 16×16 的单色线条图标（SVG path，颜色跟随文字）。
 * 不用 emoji 或符号字符：它们在不同系统上字形、大小和颜色都不一致。
 */
interface ToolbarItem {
  readonly command: ToolbarCommand
  readonly label: string
  readonly title: string
  readonly text?: string
  readonly icon?: string
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
      icon: 'M6 4h8M6 8h8M6 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
    },
    {
      command: 'ordered-list',
      label: '有序列表',
      title: '有序列表',
      icon: 'M7 4h7M7 8h7M7 12h7M2 3l1-.5V6M2 9.5c.5-.6 2-.6 2 .3 0 .8-2 1.2-2 2.2h2',
    },
    { command: 'quote', label: '引用', title: '引用', icon: 'M3 3v10M6.5 5h7M6.5 8h7M6.5 11h5' },
  ],
  [
    { command: 'code-block', label: '代码块', title: '代码块', icon: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5' },
    { command: 'table', label: '表格', title: '插入表格', icon: 'M2.5 3h11v10h-11zM2.5 6.5h11M2.5 9.8h11M6.2 3v10M9.8 3v10' },
    {
      command: 'image',
      label: '图片',
      title: '插入图片',
      icon: 'M2.5 3h11v10h-11zM2.5 11l3.2-3.2 2.3 2.3 2-2 3.5 3.4M10.5 6h.01',
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
        <svg
          v-if="item.icon"
          class="editor-toolbar__icon"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path :d="item.icon" />
        </svg>
        <template v-else>{{ item.text }}</template>
      </button>
    </div>
    <div v-if="$slots.context" class="editor-toolbar__context">
      <slot name="context" />
    </div>
  </div>
</template>

<style scoped>
.editor-toolbar {
  container-type: inline-size;
  display: flex;
  gap: 12px;
  width: 100%;
  max-width: 760px;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 4px 28px 8px;
  border-bottom: 1px solid #f3f4f6;
}

.editor-toolbar__group {
  display: flex;
  gap: 2px;
}

.editor-toolbar__context {
  display: flex;
  margin-left: auto;
}

/* 格式按钮与 context 按钮并排需要约 600px（含左右内边距）。 */
@container (max-width: 620px) {
  .editor-toolbar--context .editor-toolbar__group {
    display: none;
  }
}

.editor-toolbar__button {
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: none;
  color: #374151;
  font-size: 13px;
  cursor: pointer;
}

.editor-toolbar__icon {
  display: block;
  width: 16px;
  height: 16px;
  margin: 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.editor-toolbar__button:hover:not(:disabled) {
  background: rgba(15, 23, 42, 0.06);
}

.editor-toolbar__button--active,
.editor-toolbar__button--active:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}

.editor-toolbar__button:disabled {
  opacity: 0.35;
  cursor: default;
}

.editor-toolbar__button--bold {
  font-weight: 700;
}

.editor-toolbar__button--italic {
  font-style: italic;
  font-family: Georgia, serif;
}
</style>
