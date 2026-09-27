<script setup lang="ts">
import { computed } from 'vue'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'

/**
 * 章节树展示组件。
 *
 * 只做两件事：按 tree 渲染层级、把点击的章节通过 select 事件告诉上层。
 * 编号由 Domain 的 computeChapterNumbers 计算，组件只负责显示格式；
 * 组件不修改 tree，也不包含任何章节业务规则。
 */

const props = defineProps<{
  /** 要渲染的章节树；调用方保证是已校验的可信树。 */
  tree: ChapterTree
  /** 当前选中的章节 id；仅用于显示选中态。 */
  selectedId?: ChapterId | null
}>()

const emit = defineEmits<{
  /** 用户选中了某个章节。 */
  select: [chapterId: ChapterId]
}>()

interface ChapterRow {
  readonly id: ChapterId
  readonly title: string
  readonly number: string
  readonly depth: number
}

/** 把树摊平成带层级的显示行；编号来自 Domain，depth 仅用于缩进。 */
const rows = computed<ChapterRow[]>(() => {
  const numbers = computeChapterNumbers(props.tree)
  const result: ChapterRow[] = []

  const visit = (nodes: ChapterTree, depth: number): void => {
    for (const node of nodes) {
      result.push({
        id: node.id,
        title: node.title,
        number: (numbers.get(node.id) ?? []).join('.'),
        depth,
      })
      visit(node.children, depth + 1)
    }
  }

  visit(props.tree, 0)
  return result
})
</script>

<template>
  <ul class="chapter-tree">
    <li v-for="row in rows" :key="row.id" class="chapter-tree__node">
      <button
        type="button"
        class="chapter-tree__row"
        :class="{ 'chapter-tree__row--selected': row.id === selectedId }"
        :data-depth="row.depth"
        :style="{ paddingLeft: `${row.depth * 1.25}rem` }"
        :aria-current="row.id === selectedId ? 'true' : undefined"
        @click="emit('select', row.id)"
      >
        <span class="chapter-tree__number">{{ row.number }}</span>
        <span class="chapter-tree__title">{{ row.title }}</span>
      </button>
    </li>
  </ul>
</template>
