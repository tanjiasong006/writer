<script setup lang="ts">
import ChapterManager from './ui/chapter_tree/ChapterManager.vue'
import type { ChapterTree } from './domain/chapter_tree/chapter_tree.ts'

/**
 * 应用入口：只负责挂载章节管理组合组件。
 * 尚未接入持久化，先用最小示例数据展示章节树。
 */
const initialTree: ChapterTree = [
  {
    id: 'chapter-1',
    title: '第一章',
    children: [{ id: 'chapter-1-1', title: '第一节', children: [] }],
  },
  { id: 'chapter-2', title: '第二章', children: [] },
]
</script>

<template>
  <main class="app">
    <h1 class="app__title">Writer</h1>
    <ChapterManager :initial-tree="initialTree" />
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
