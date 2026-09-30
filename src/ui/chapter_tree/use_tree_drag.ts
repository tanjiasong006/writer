import { computed, onBeforeUnmount, ref, shallowRef, type Ref } from 'vue'
import { findChapter, type ChapterId, type ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { canMoveChapter, moveChapterTo, type MoveIntent } from '../../application/move_chapter.ts'
import { autoScrollStep, resolveDropPosition, type DropPosition } from './drop_target.ts'
import type { ChapterRow } from './tree_rows.ts'

/**
 * 当前落点：目标章节 id 与相对位置；离开有效目标后清空。
 * zone 为 tail 表示树下方的空白区域：放到最后一个根章节之后（成为最后一个一级章节）。
 */
export interface DropTarget {
  readonly id: ChapterId
  readonly position: DropPosition
  readonly zone: 'row' | 'tail'
}

/** 拖到折叠章节的 inside 区域并停留时自动展开它（ui-spec §18）。 */
const EXPAND_DELAY_MS = 600

/**
 * 章节树的拖拽：拖动状态、落点反馈（插入线、松手后的新编号）、边缘自动滚动、停留自动展开。
 *
 * 有效落点时接受放下（preventDefault）并显示反馈；无效落点（自身、自身后代、不会产生位移的位置）
 * 不接受，系统显示"不可放下"的光标，也不显示任何插入线（ui-spec §17）。
 * 是否可以移动、移动后的编号都由 Application 判断；这里只发出移动意图，不修改 tree。
 */
export function useTreeDrag(options: {
  readonly tree: () => ChapterTree
  readonly collapsedIds: Readonly<Ref<ReadonlySet<ChapterId>>>
  /** 章节树列表元素：向上查找滚动区域。 */
  readonly list: Readonly<Ref<HTMLElement | null>>
  /** 展开一个折叠的章节。 */
  readonly expand: (chapterId: ChapterId) => void
  readonly onStart: () => void
  /** 在有效落点上松手。 */
  readonly onDrop: (intent: MoveIntent) => void
}) {
  /** 正在被拖动的章节 id；为 null 表示没有拖拽。 */
  const draggingId = ref<ChapterId | null>(null)

  /** 被拖动的章节及其所有子章节：它们会一起移动，因此一起变淡。 */
  const draggingIds = computed<ReadonlySet<ChapterId>>(() => {
    const ids = new Set<ChapterId>()
    const node = draggingId.value === null ? null : findChapter(options.tree(), draggingId.value)
    const collect = (current: { readonly id: ChapterId; readonly children: ChapterTree }) => {
      ids.add(current.id)
      for (const child of current.children) collect(child)
    }
    if (node) collect(node)
    return ids
  })

  const dropTarget = shallowRef<DropTarget | null>(null)

  function setDropTarget(next: DropTarget | null): void {
    const current = dropTarget.value
    if (current === next) return
    if (current && next && current.id === next.id && current.position === next.position && current.zone === next.zone) return
    dropTarget.value = next
  }

  /**
   * 松手后被拖动章节的新编号（如 "2.2"），显示在落点旁：用户在松手前就知道章节会去哪里、成为哪一级。
   * 由 Application 在当前树上执行同一次移动得到；只在落点变化时计算。
   */
  const dropNumber = computed<string | null>(() => {
    const target = dropTarget.value
    const chapterId = draggingId.value
    if (target === null || chapterId === null) return null
    const result = moveChapterTo(options.tree(), { chapterId, targetChapterId: target.id, position: target.position })
    if (!result.ok) return null
    return (computeChapterNumbers(result.tree).get(chapterId) ?? []).join('.')
  })

  function startDrag(event: DragEvent, row: ChapterRow): void {
    options.onStart()
    draggingId.value = row.id
    setDropTarget(null)
    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return
    dataTransfer.effectAllowed = 'move'
    if (typeof dataTransfer.setDragImage !== 'function') return
    // Drag Preview 只带编号 + 标题的轻量浮层，不复制整行节点 UI。
    const preview = document.createElement('div')
    preview.textContent = `${row.number}  ${row.title}`
    Object.assign(preview.style, {
      position: 'fixed',
      top: '-1000px',
      left: '-1000px',
      maxWidth: '280px',
      padding: '0 10px',
      height: '26px',
      lineHeight: '26px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      background: 'var(--color-bg-raised)',
      borderRadius: 'var(--radius-m)',
      boxShadow: 'var(--shadow-popover)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-m)',
      color: 'var(--color-text)',
      whiteSpace: 'pre',
      pointerEvents: 'none',
    })
    document.body.appendChild(preview)
    dataTransfer.setDragImage(preview, 12, 13)
    // 浏览器已同步读取图像，下一帧移除即可。
    window.setTimeout(() => preview.remove(), 0)
  }

  /** 章节树所在的滚动区域；找不到时为 null。 */
  function scrollContainer(): HTMLElement | null {
    let node = options.list.value?.parentElement ?? null
    while (node) {
      const overflow = getComputedStyle(node).overflowY
      if (overflow === 'auto' || overflow === 'scroll') return node
      node = node.parentElement
    }
    return null
  }

  /** 拖拽到滚动区域上 / 下边缘附近时自动滚动，长章节树中也能把章节拖到很远的位置。 */
  function autoScroll(event: DragEvent): void {
    if (draggingId.value === null) return
    const container = scrollContainer()
    if (!container) return
    const rect = container.getBoundingClientRect()
    const step = autoScrollStep(event.clientY, { top: rect.top, height: rect.height })
    if (step !== 0) container.scrollTop += step
  }

  let expandTimer: ReturnType<typeof setTimeout> | null = null
  let expandTargetId: ChapterId | null = null

  function scheduleExpand(chapterId: ChapterId | null): void {
    if (chapterId === expandTargetId) return
    if (expandTimer !== null) clearTimeout(expandTimer)
    expandTimer = null
    expandTargetId = chapterId
    if (chapterId === null) return
    expandTimer = setTimeout(() => {
      expandTimer = null
      if (draggingId.value !== null && options.collapsedIds.value.has(chapterId)) options.expand(chapterId)
    }, EXPAND_DELAY_MS)
  }

  function dragOverRow(event: DragEvent, row: ChapterRow): void {
    const dragging = draggingId.value
    if (dragging === null) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const position = resolveDropPosition(event.clientY, { top: rect.top, height: rect.height })
    const intent: MoveIntent = { chapterId: dragging, targetChapterId: row.id, position }
    if (row.id === dragging || !canMoveChapter(options.tree(), intent)) {
      setDropTarget(null)
      scheduleExpand(null)
      return
    }
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setDropTarget({ id: row.id, position, zone: 'row' })
    scheduleExpand(position === 'inside' && row.hasChildren && options.collapsedIds.value.has(row.id) ? row.id : null)
  }

  /** 树下方的空白区域：放到最后一个根章节之后。 */
  function dragOverTail(event: DragEvent): void {
    const dragging = draggingId.value
    const tree = options.tree()
    const last = tree[tree.length - 1]
    scheduleExpand(null)
    if (dragging === null || last === undefined) return
    const intent: MoveIntent = { chapterId: dragging, targetChapterId: last.id, position: 'after' }
    if (last.id === dragging || !canMoveChapter(tree, intent)) {
      setDropTarget(null)
      return
    }
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setDropTarget({ id: last.id, position: 'after', zone: 'tail' })
  }

  function leaveRow(event: DragEvent, chapterId: ChapterId): void {
    // 进入行内的子元素也会触发 dragleave；只有真正离开这一行时才清除。
    const next = event.relatedTarget as Node | null
    if (next && (event.currentTarget as HTMLElement).contains(next)) return
    if (dropTarget.value?.id === chapterId && dropTarget.value.zone === 'row') setDropTarget(null)
  }

  function leaveTail(): void {
    if (dropTarget.value?.zone === 'tail') setDropTarget(null)
  }

  /** 松手：有有效落点时发一个 move 意图，然后一律清空拖拽状态。 */
  function drop(): void {
    const target = dropTarget.value
    const chapterId = draggingId.value
    if (chapterId !== null && target !== null) {
      options.onDrop({ chapterId, targetChapterId: target.id, position: target.position })
    }
    endDrag()
  }

  /** 松手或拖拽结束都清空拖拽状态。 */
  function endDrag(): void {
    draggingId.value = null
    setDropTarget(null)
    scheduleExpand(null)
  }

  onBeforeUnmount(() => {
    if (expandTimer !== null) clearTimeout(expandTimer)
  })

  /** 落在某一行上的落点（不含树下方的空白区域）。 */
  function rowDropTarget(chapterId: ChapterId): DropTarget | null {
    const target = dropTarget.value
    return target !== null && target.zone === 'row' && target.id === chapterId ? target : null
  }

  return {
    draggingId,
    draggingIds,
    dropTarget,
    dropNumber,
    rowDropTarget,
    startDrag,
    autoScroll,
    dragOverRow,
    dragOverTail,
    leaveRow,
    leaveTail,
    drop,
    endDrag,
  }
}
