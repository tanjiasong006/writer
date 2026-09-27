<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { resolveDropPosition, type DropPosition } from './drop_target.ts'
import { canMoveChapter, type MoveIntent } from '../../application/move_chapter.ts'

/**
 * 章节树展示组件。
 *
 * 四件事：按 tree 渲染层级、把点击的章节通过 select 事件告诉上层、
 * 折叠/展开有子章节的节点、拖拽时用 DropTarget 提示落点。
 * 折叠与拖拽落点都是纯 UI 状态，默认全部展开，不回写 tree。
 * 编号由 Domain 的 computeChapterNumbers 计算，组件只负责显示格式；
 * 组件不修改 tree，也不包含任何章节业务规则。拖拽松手时只发出 move 意图，
 * 由上层（Application）决定是否、如何修改章节树。
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
  /** 用户在有效落点上松手，发出移动意图；组件不直接修改 tree。 */
  move: [intent: MoveIntent]
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

/**
 * 选中章节变化，或树引用变化时，展开选中章节的所有祖先，保证它可见。
 * 例如在折叠的父章节下新增子章节，或把选中章节拖入已折叠的父节点。
 * 树是不可变更新（每次生成新引用），因此只 watch 引用即可，无需 deep watch。
 */
watch(
  [() => props.selectedId, () => props.tree],
  () => {
    const id = props.selectedId
    if (id === null || id === undefined) return
    const path = ancestorPath(props.tree, id)
    if (path === null || path.length === 0) return
    const next = new Set(collapsedIds.value)
    let changed = false
    for (const ancestorId of path) {
      if (next.delete(ancestorId)) changed = true
    }
    if (changed) collapsedIds.value = next
  },
)

/** 返回从根到 id 的祖先 id 列表（不含 id 本身）；找不到返回 null。 */
function ancestorPath(nodes: ChapterTree, id: ChapterId): ChapterId[] | null {
  for (const node of nodes) {
    if (node.id === id) return []
    const childPath = ancestorPath(node.children, id)
    if (childPath !== null) return [node.id, ...childPath]
  }
  return null
}

/** 正在被拖动的章节 id；为 null 表示没有拖拽。 */
const draggingId = ref<ChapterId | null>(null)

/** 当前落点：命中行 id 与相对位置；离开有效目标后清空。 */
const dropTarget = ref<{ readonly id: ChapterId; readonly position: DropPosition } | null>(null)

function startDrag(chapterId: ChapterId): void {
  draggingId.value = chapterId
  dropTarget.value = null
}

function updateDropTarget(event: DragEvent, chapterId: ChapterId): void {
  const dragging = draggingId.value
  // 拖到自己身上不算有效目标，清掉反馈。
  if (dragging === null || chapterId === dragging) {
    dropTarget.value = null
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const position = resolveDropPosition(event.clientY, { top: rect.top, height: rect.height })
  // 自身、自身后代、以及不会产生位移的落点都不算有效目标，不显示反馈。
  const intent: MoveIntent = { chapterId: dragging, targetChapterId: chapterId, position }
  if (!canMoveChapter(props.tree, intent)) {
    dropTarget.value = null
    return
  }
  dropTarget.value = { id: chapterId, position }
}

function leaveRow(chapterId: ChapterId): void {
  if (dropTarget.value?.id === chapterId) dropTarget.value = null
}

/** 松手：有有效落点时发一个 move 意图，然后一律清空拖拽状态。 */
function drop(): void {
  const target = dropTarget.value
  const chapterId = draggingId.value
  if (chapterId !== null && target !== null) {
    emit('move', { chapterId, targetChapterId: target.id, position: target.position })
  }
  endDrag()
}

/** 松手或拖拽结束都清空拖拽状态；本组件不修改 tree。 */
function endDrag(): void {
  draggingId.value = null
  dropTarget.value = null
}

function dropClass(chapterId: ChapterId): string | null {
  if (dropTarget.value?.id !== chapterId) return null
  return `chapter-tree__row--drop-${dropTarget.value.position}`
}

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
  <ul class="chapter-tree" role="tree" aria-label="章节树">
    <li
      v-for="row in rows"
      :key="row.id"
      class="chapter-tree__node"
      role="treeitem"
      :aria-level="row.depth + 1"
      :aria-selected="row.id === selectedId"
      :aria-expanded="row.hasChildren ? !collapsedIds.has(row.id) : undefined"
    >
      <div
        class="chapter-tree__row"
        draggable="true"
        :class="[
          { 'chapter-tree__row--selected': row.id === selectedId },
          { 'chapter-tree__row--dragging': row.id === draggingId },
          dropClass(row.id),
        ]"
        :data-depth="row.depth"
        :style="{ paddingLeft: `${row.depth * 1.25}rem` }"
        :aria-current="row.id === selectedId ? 'true' : undefined"
        @click="emit('select', row.id)"
        @dragstart="startDrag(row.id)"
        @dragover.prevent="updateDropTarget($event, row.id)"
        @dragleave="leaveRow(row.id)"
        @drop.prevent="drop"
        @dragend="endDrag"
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

.chapter-tree__row--selected {
  background: rgba(59, 130, 246, 0.1);
}

.chapter-tree__row--dragging {
  opacity: 0.5;
}

/* 插入线用 inset 阴影，避免改变行高导致布局抖动。 */
.chapter-tree__row--drop-before {
  box-shadow: inset 0 2px 0 0 #3b82f6;
}

.chapter-tree__row--drop-after {
  box-shadow: inset 0 -2px 0 0 #3b82f6;
}

.chapter-tree__row--drop-inside {
  background: rgba(59, 130, 246, 0.15);
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
