<script setup lang="ts">
/**
 * 正文工具栏：常用 Markdown 内容的插入入口（docs/decisions.md 第 2 节）。
 * 只发出命令名，具体文本变换由 markdown_commands 完成。
 * 按钮在 mousedown 时阻止默认行为，点击后焦点仍留在编辑器中。
 */
export type ToolbarCommand =
  | 'bold'
  | 'italic'
  | 'bullet-list'
  | 'ordered-list'
  | 'quote'
  | 'code-block'
  | 'table'
  | 'image'

const emit = defineEmits<{ command: [command: ToolbarCommand] }>()

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

const groups: ReadonlyArray<ReadonlyArray<{ command: ToolbarCommand; label: string; text: string; title: string }>> = [
  [
    { command: 'bold', label: '粗体', text: 'B', title: `粗体（${mod}B）` },
    { command: 'italic', label: '斜体', text: 'I', title: `斜体（${mod}I）` },
  ],
  [
    { command: 'bullet-list', label: '无序列表', text: '•', title: '无序列表' },
    { command: 'ordered-list', label: '有序列表', text: '1.', title: '有序列表' },
    { command: 'quote', label: '引用', text: '❝', title: '引用' },
  ],
  [
    { command: 'code-block', label: '代码块', text: '</>', title: '代码块' },
    { command: 'table', label: '表格', text: '▦', title: '插入表格' },
    { command: 'image', label: '图片', text: '🖼', title: '插入图片' },
  ],
]
</script>

<template>
  <div class="editor-toolbar" role="toolbar" aria-label="正文格式">
    <div v-for="(group, index) in groups" :key="index" class="editor-toolbar__group">
      <button
        v-for="item in group"
        :key="item.command"
        type="button"
        class="editor-toolbar__button"
        :class="`editor-toolbar__button--${item.command}`"
        :aria-label="item.label"
        :title="item.title"
        @mousedown.prevent
        @click="emit('command', item.command)"
      >
        {{ item.text }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.editor-toolbar {
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

.editor-toolbar__button:hover {
  background: rgba(15, 23, 42, 0.06);
}

.editor-toolbar__button--bold {
  font-weight: 700;
}

.editor-toolbar__button--italic {
  font-style: italic;
  font-family: Georgia, serif;
}
</style>
