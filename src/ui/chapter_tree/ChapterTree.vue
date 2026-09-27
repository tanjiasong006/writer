<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'

/**
 * 章节树展示组件。
 *
 * 三件事：按 tree 渲染层级、把点击的章节通过 select 事件告诉上层、
 * 折叠/展开有子章节的节点。折叠状态是纯 UI 状态，默认全部展开，不回写 tree。
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
  readonly hasChildren: boolean
}

/** 被用户折叠的章节 id；只影响显示，不进入 Domain。 */
const collapsedIds = ref(new Set<ChapterId>())

function toggle(chapterId: ChapterId): void {
  const next = new Set(collapsedIds.value)
  if (next.has(chapterId)) next.delete(chapterId)
  else next.add(chapterId)
  collapsedIds.value = next
}

/** 把树摊平成带层级的显示行；折叠节点不展开其后代。 */
const rows = computed<ChapterRow[]>(() => {
  const numbers = computeChapterNumbers(props.tree)
  const result: ChapterRow[] = []

  const visit = (nodes: ChapterTree, depth: number): void => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0
      result.push({
        id: node.id,
        title: node.title,
        number: (numbers.get(node.id) ?? []).join('.'),
        depth,
        hasChildren,
      })
      if (hasChildren && !collapsedIds.value.has(node.id)) {
        visit(node.children, depth + 1)
      }
    }
  }

  visit(props.tree, 0)
  return result
})
</script>

<template>
  <ul class="chapter-tree">
    <li v-for="row in rows" :key="row.id" class="chapter-tree__node">
      <div
        class="chapter-tree__row"
        :class="{ 'chapter-tree__row--selected': row.id === selectedId }"
        :data-depth="row.depth"
        :style="{ paddingLeft: `${row.depth * 1.25}rem` }"
        :aria-current="row.id === selectedId ? 'true' : undefined"
        @click="emit('select', row.id)"
      >
        <button
          v-if="row.hasChildren"
          type="button"
          class="chapter-tree__toggle"
          :aria-expanded="!collapsedIds.has(row.id)"
          :aria-label="collapsedIds.has(row.id) ? '展开' : '折叠'"
          @click.stop="toggle(row.id)"
        ></button>
        <span v-else class="chapter-tree__toggle chapter-tree__toggle--leaf" aria-hidden="true"></span>
        <button type="button" class="chapter-tree__label">
          <span class="chapter-tree__number">{{ row.number }}</span>
          <span class="chapter-tree__title">{{ row.title }}</span>
        </button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.chapter-tree__row {
  display: flex;
  align-items: center;
}

.chapter-tree__toggle {
  width: 1.25rem;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
}

.chapter-tree__toggle::before {
  content: '▾';
}

.chapter-tree__toggle[aria-expanded='false']::before {
  content: '▸';
}

.chapter-tree__toggle--leaf {
  cursor: default;
}

.chapter-tree__label {
  flex: 1;
  display: flex;
  gap: 0.5rem;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  text-align: left;
}
</style>
