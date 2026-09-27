<script setup lang="ts">
import { ref } from 'vue'
import ChapterTree from './ui/chapter_tree/ChapterTree.vue'
import type { ChapterId, ChapterTree as ChapterTreeModel } from './domain/chapter_tree/chapter_tree.ts'
import type { MoveReason } from './domain/chapter_tree/chapter_tree.ts'
import { moveChapterTo, type MoveIntent } from './application/move_chapter.ts'

/**
 * 应用入口的最小组合层：持有当前章节树和选中章节，渲染 ChapterTree，
 * 并把 select / move 事件接到 Application 用例上。
 * 这里不实现任何章节树规则，规则全部由 Domain 负责。
 * 尚未接入持久化与编辑器，初始树只是最小示例数据。
 */
const tree = ref<ChapterTreeModel>([
  {
    id: 'chapter-1',
    title: '第一章',
    children: [{ id: 'chapter-1-1', title: '第一节', children: [] }],
  },
  { id: 'chapter-2', title: '第二章', children: [] },
])

const selectedId = ref<ChapterId | null>(null)
const moveError = ref<string | null>(null)

function select(chapterId: ChapterId): void {
  selectedId.value = chapterId
}

function move(intent: MoveIntent): void {
  const result = moveChapterTo(tree.value, intent)
  if (result.ok) {
    tree.value = result.tree
    moveError.value = null
    return
  }
  moveError.value = messageForMoveReason(result.reason)
}

/** Domain 只给机器可读 reason，面向用户的文案由 UI 层负责。 */
function messageForMoveReason(reason: MoveReason): string {
  switch (reason) {
    case 'chapter-not-found':
      return '要移动的章节不存在。'
    case 'target-not-found':
      return '目标章节不存在。'
    case 'target-is-descendant':
      return '不能把章节移动到它自己的子章节里。'
    case 'index-out-of-range':
      return '目标位置无效。'
  }
}
</script>

<template>
  <main class="app">
    <h1 class="app__title">Writer</h1>
    <ChapterTree :tree="tree" :selected-id="selectedId" @select="select" @move="move" />
    <p v-if="moveError" class="app__error" role="alert">{{ moveError }}</p>
  </main>
</template>

<style scoped>
.app {
  max-width: 40rem;
  margin: 0 auto;
  padding: 2rem 1rem;
  text-align: left;
}

.app__title {
  font-size: 1.25rem;
}

.app__error {
  margin-top: 1rem;
  color: #b91c1c;
}
</style>

<style>
:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;

  color: #0f0f0f;
  background-color: #f6f6f6;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

@media (prefers-color-scheme: dark) {
  :root {
    color: #f6f6f6;
    background-color: #2f2f2f;
  }
}
</style>
