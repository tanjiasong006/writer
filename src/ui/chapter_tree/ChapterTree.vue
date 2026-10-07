<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { findChapter, type ChapterId, type ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { keyboardMoveIntent, type KeyboardMoveDirection, type MoveIntent } from '../../application/move_chapter.ts'
import { ancestorPath, numberWidths, visibleRows, type ChapterRow } from './tree_rows.ts'
import { useTreeDrag } from './use_tree_drag.ts'
import { useInlineRename } from './use_inline_rename.ts'
import { useRowWindow } from './use_row_window.ts'
import PopupMenu, { type MenuAnchor, type MenuEntry } from '../common/PopupMenu.vue'
import { CHAPTER_STATUSES, type ChapterStatus } from '../../domain/chapter_tree/chapter_tree.ts'
import { STATUS_LABELS } from './status_labels.ts'
import Icon from '../common/Icon.vue'
import { useMenu } from '../common/use_menu.ts'
import { SHORTCUTS, matchesShortcut } from '../common/shortcuts.ts'
import { MOVE_LABELS } from '../app_shell/app_menu.ts'

/**
 * 章节树组件。
 *
 * 负责：按 tree 渲染层级、选择、折叠/展开、拖拽落点反馈、Tree Header、
 * 节点菜单与右键菜单、内联重命名、键盘导航与键盘移动、空状态。
 *
 * 拖拽反馈除了 before / inside / after 的插入线与高亮，还显示松手后章节的新编号：
 * 编号由 Application 的 moveChapterTo 在当前树的副本上执行同一次移动得到，UI 不推算结构。
 *
 * 所有会产生结构变化的行为都只发出意图事件，由上层（Application）执行；
 * 组件不判断移动是否合法、不构造新树，也不包含任何章节结构规则。
 * 折叠、菜单、正在编辑的章节都是纯 UI 状态，不回写 tree。
 *
 * 显示行的摊平在 tree_rows.ts，拖拽在 use_tree_drag.ts，内联重命名在 use_inline_rename.ts。
 */

const props = defineProps<{
  /** 要渲染的章节树；调用方保证是已校验的可信树。 */
  tree: ChapterTree
  /** 当前选中的章节 id；仅用于显示选中态。 */
  selectedId?: ChapterId | null
  /** 正在内联重命名的章节 id；由上层在新建后或用户触发时设置。 */
  editingId?: ChapterId | null
}>()

const emit = defineEmits<{
  /** 用户选中了某个章节。 */
  select: [chapterId: ChapterId]
  /** 用户在有效落点上松手，发出移动意图；组件不直接修改 tree。 */
  move: [intent: MoveIntent]
  /** Tree Header + ：在当前章节之后新建（无选中时由上层追加到根末尾）。 */
  'create-root': []
  /** 在指定章节之后新建同级章节。 */
  'create-sibling': [chapterId: ChapterId]
  /** 在指定章节下新建子章节。 */
  'create-child': [chapterId: ChapterId]
  /** 请求进入重命名编辑（双击标题 / 菜单）。 */
  'start-rename': [chapterId: ChapterId]
  /** 内联重命名提交新标题。 */
  rename: [chapterId: ChapterId, title: string]
  /** 放弃本次重命名。 */
  'cancel-rename': []
  /** 请求删除章节，由上层决定是否确认。 */
  delete: [chapterId: ChapterId]
  /** Enter：进入当前章节的正文编辑（包括为新章节确认标题后）。 */
  open: [chapterId: ChapterId]
  /** 设置写作状态（null 去掉）。 */
  'set-status': [chapterId: ChapterId, status: ChapterStatus | null]
  /** 编辑章节备注；rect 是该行的位置（浮层在它下方）。 */
  'edit-note': [chapterId: ChapterId, rect: DOMRect]
}>()

/**
 * 被用户折叠的章节 id；只影响显示，不进入 Domain。
 * 上层可以绑定 v-model:collapsed-ids 以随项目保存；不绑定时是组件内部状态。
 */
const collapsedIds = defineModel<ReadonlySet<ChapterId>>('collapsedIds', {
  default: () => new Set<ChapterId>(),
})

const listElement = ref<HTMLElement | null>(null)

/**
 * 当前章节变化后让它可见（ui-spec §28）：祖先已由下面的 watch 展开，
 * 这里等 DOM 更新后用 block: 'nearest' 滚动，避免强烈跳动。
 */
watch(
  () => props.selectedId,
  async () => {
    await nextTick()
    const row = listElement.value?.querySelector<HTMLElement>('.chapter-tree__row--selected')
    row?.scrollIntoView?.({ block: 'nearest' })
  },
)

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

/** 刚刚移动的章节：短暂高亮它的新位置，说明结构发生了什么变化。 */
const settledId = ref<ChapterId | null>(null)
let settleTimer: ReturnType<typeof setTimeout> | null = null
const SETTLE_MS = 900

function markSettled(chapterId: ChapterId): void {
  if (settleTimer !== null) clearTimeout(settleTimer)
  settledId.value = chapterId
  settleTimer = setTimeout(() => {
    settleTimer = null
    settledId.value = null
  }, SETTLE_MS)
}

const {
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
} = useTreeDrag({
  tree: () => props.tree,
  collapsedIds,
  list: listElement,
  expand: toggle,
  onStart: closeMenu,
  onDrop: (intent) => {
    emit('move', intent)
    markSettled(intent.chapterId)
  },
})

onBeforeUnmount(() => {
  if (settleTimer !== null) clearTimeout(settleTimer)
})

function dropClass(chapterId: ChapterId): string | null {
  const target = rowDropTarget(chapterId)
  return target === null ? null : `chapter-tree__row--drop-${target.position}`
}

/** 章节行左侧的留白；各层按 16px 缩进（ui-spec §3）。 */
const ROW_INSET = 4
const INDENT = 16
const TOGGLE = 20

function rowPadding(depth: number): string {
  return `${ROW_INSET + depth * INDENT}px`
}

/** 插入线从落点层级的编号处开始：线的位置就是章节松手后所在的层级（ui-spec §16）。 */
function lineLeft(depth: number): string {
  return `${ROW_INSET + depth * INDENT + TOGGLE}px`
}

function toggle(chapterId: ChapterId): void {
  const next = new Set(collapsedIds.value)
  if (next.has(chapterId)) next.delete(chapterId)
  else next.add(chapterId)
  collapsedIds.value = next
}

function renameFromDoubleClick(row: ChapterRow): void {
  requestStartRename(row.id)
}

/**
 * 节点菜单（··· 按钮、右键、Shift+F10 / 菜单键）。桌面环境中是系统菜单（use_menu.ts）。同一时间只有一个菜单。
 * 右键打开时不改变选中章节，只用描边标出菜单作用的行（桌面文件列表的习惯）。
 */
interface MenuTarget {
  readonly id: ChapterId
  readonly context: boolean
}
const menuTarget = shallowRef<MenuTarget | null>(null)
const openMenuId = computed(() => menuTarget.value?.id ?? null)
const menu = useMenu()

async function showMenu(chapterId: ChapterId, anchor: MenuAnchor, keyboard: boolean, context: boolean): Promise<void> {
  menuTarget.value = { id: chapterId, context }
  const action = await menu.open(menuItems(chapterId), anchor, keyboard)
  // 菜单关闭后才清除标记；若期间又打开了另一个菜单，由新的菜单负责。
  if (menuTarget.value?.id === chapterId && menuTarget.value.context === context) menuTarget.value = null
  if (action !== null) onMenuSelect(chapterId, action)
}

function toggleMenu(chapterId: ChapterId, event: MouseEvent): void {
  if (menuTarget.value?.id === chapterId && !menuTarget.value.context) {
    closeMenu()
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // 由键盘（Enter / Space）触发的 click 没有点击次数：菜单打开后第一项获得焦点。
  void showMenu(chapterId, { rect, align: 'end' }, event.detail === 0, false)
}

/** 重命名中的行保留输入框的系统菜单（剪切 / 拷贝 / 粘贴）。 */
function openContextMenu(event: MouseEvent, row: ChapterRow): void {
  if (row.id === props.editingId) return
  event.preventDefault()
  void showMenu(row.id, { x: event.clientX, y: event.clientY }, false, true)
}

function openMenuFromKeyboard(row: ChapterRow, target: HTMLElement): void {
  const rect = target.getBoundingClientRect()
  void showMenu(row.id, { rect, align: 'start' }, true, true)
}

/** 打开焦点章节的菜单（菜单栏的"显示操作菜单"，⌘/），与在该章节上按 Shift+F10 相同。 */
function openFocusedMenu(): void {
  const id = tabbableId.value
  if (id === null) return
  const label = listElement.value?.querySelector<HTMLElement>(`.chapter-tree__label[data-chapter-id="${CSS.escape(id)}"]`)
  if (label) void showMenu(id, { rect: label.getBoundingClientRect(), align: 'start' }, true, true)
}

function closeMenu(): void {
  menuTarget.value = null
  menu.close()
}

function menuItems(chapterId: ChapterId): MenuEntry[] {
  return [
    { id: 'create-sibling', label: '新建同级章节', shortcut: SHORTCUTS.newChapter },
    { id: 'create-child', label: '新建子章节' },
    { separator: true },
    ...MOVE_LABELS.map((item) => ({
      id: `move-${item.direction}`,
      label: item.label,
      shortcut: item.shortcut,
      disabled: !canMoveBy(chapterId, item.direction),
    })),
    { separator: true },
    {
      id: 'status',
      label: '状态',
      submenu: [
        { id: 'status:none', label: '无', checked: !statusOf(chapterId) },
        { separator: true },
        ...CHAPTER_STATUSES.map((status) => ({
          id: `status:${status}`,
          label: STATUS_LABELS[status],
          checked: statusOf(chapterId) === status,
        })),
      ],
    },
    { id: 'note', label: findChapter(props.tree, chapterId)?.note ? '编辑备注…' : '添加备注…' },
    { separator: true },
    { id: 'rename', label: '重命名', shortcut: SHORTCUTS.renameChapter },
    { id: 'delete', label: '删除', shortcut: SHORTCUTS.deleteChapter },
  ]
}

function statusOf(chapterId: ChapterId): ChapterStatus | undefined {
  return findChapter(props.tree, chapterId)?.status
}

function onMenuSelect(chapterId: ChapterId, action: string): void {
  if (action === 'create-sibling') requestCreateSibling(chapterId)
  else if (action === 'create-child') requestCreateChild(chapterId)
  else if (action === 'rename') requestStartRename(chapterId)
  else if (action === 'delete') requestDelete(chapterId)
  else if (action.startsWith('status:')) {
    closeMenu()
    const status = action.slice('status:'.length)
    emit('set-status', chapterId, status === 'none' ? null : (status as ChapterStatus))
  } else if (action === 'note') {
    closeMenu()
    const label = listElement.value?.querySelector<HTMLElement>(`.chapter-tree__label[data-chapter-id="${CSS.escape(chapterId)}"]`)
    if (label) emit('edit-note', chapterId, label.getBoundingClientRect())
  } else {
    const move = MOVE_LABELS.find((item) => action === `move-${item.direction}`)
    if (move) requestMove(chapterId, move.direction)
  }
}

function requestCreateRoot(): void {
  closeMenu()
  emit('create-root')
}

function requestCreateSibling(chapterId: ChapterId): void {
  closeMenu()
  emit('create-sibling', chapterId)
}

function requestCreateChild(chapterId: ChapterId): void {
  closeMenu()
  emit('create-child', chapterId)
}

function requestStartRename(chapterId: ChapterId): void {
  closeMenu()
  emit('start-rename', chapterId)
}

function requestDelete(chapterId: ChapterId): void {
  closeMenu()
  emit('delete', chapterId)
}

/**
 * 键盘焦点所在章节（ui-spec §30）。与 selectedId 是两个概念：
 * 选中章节变化时焦点跟随，但焦点可以停在未选中的行（如尚无选中时 Tab 进入树）。
 */
const focusedId = ref<ChapterId | null>(null)

watch(
  () => props.selectedId,
  (id) => {
    if (id !== null && id !== undefined) focusedId.value = id
  },
  { immediate: true },
)

/**
 * 树内只有一行可以被 Tab 聚焦（roving tabindex）：焦点行可见时是它，
 * 否则是可见的选中行，再否则是第一行。
 */
const tabbableId = computed<ChapterId | null>(() => {
  const visible = (id: ChapterId | null | undefined): boolean =>
    id !== null && id !== undefined && rows.value.some((row) => row.id === id)
  if (visible(focusedId.value)) return focusedId.value
  if (visible(props.selectedId)) return props.selectedId ?? null
  return rows.value[0]?.id ?? null
})

/** 把键盘焦点移到某一行；等 DOM 更新后再聚焦，行在重排后是新位置。 */
async function focusRow(chapterId: ChapterId): Promise<void> {
  focusedId.value = chapterId
  await nextTick()
  const label = listElement.value?.querySelector<HTMLElement>(
    `.chapter-tree__label[data-chapter-id="${CSS.escape(chapterId)}"]`,
  )
  label?.focus()
}

/**
 * 鼠标点在章节树的任何位置（行内空白、编号、箭头、行间、树下方空白）都让树获得焦点，而不只是点标题：
 * 焦点落在被点的行，点在行外时落在可 Tab 聚焦的行。重命名输入框与"更多操作"自己管理焦点。
 * 鼠标激活不显示键盘焦点描边。
 */
function focusFromPointer(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (target.closest('.chapter-tree__edit, .chapter-tree__more')) return
  const rowLabel = target.closest('.chapter-tree__row')?.querySelector<HTMLElement>('.chapter-tree__label')
  const id = rowLabel?.dataset.chapterId ?? tabbableId.value
  if (id === null || id === undefined) return
  focusedId.value = id
  void nextTick(() => {
    listElement.value
      ?.querySelector<HTMLElement>(`.chapter-tree__label[data-chapter-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
  })
}

function selectAndFocus(chapterId: ChapterId): void {
  if (chapterId !== props.selectedId) emit('select', chapterId)
  void focusRow(chapterId)
}

/** 从根到 id 的父章节 id；根章节或找不到时为 null。 */
function parentOf(chapterId: ChapterId): ChapterId | null {
  const path = ancestorPath(props.tree, chapterId)
  return path === null || path.length === 0 ? null : path[path.length - 1]
}

function canMoveBy(chapterId: ChapterId, direction: KeyboardMoveDirection): boolean {
  return keyboardMoveIntent(props.tree, chapterId, direction) !== null
}

/** 上移 / 下移 / 升级 / 降级：换算成与拖拽相同的 MoveIntent；已在边界时什么也不做。 */
function requestMove(chapterId: ChapterId, direction: KeyboardMoveDirection): void {
  closeMenu()
  const intent = keyboardMoveIntent(props.tree, chapterId, direction)
  if (intent === null) return
  if (chapterId !== props.selectedId) emit('select', chapterId)
  emit('move', intent)
  markSettled(chapterId)
  // 行在 DOM 中被重排后会失去焦点，移动后把焦点放回原章节。
  void focusRow(chapterId)
}

/** vim 的移动键：在章节树中等同方向键。 */
const VIM_KEYS: Readonly<Record<string, string>> = { h: 'ArrowLeft', j: 'ArrowDown', k: 'ArrowUp', l: 'ArrowRight' }

/** 章节行上的快捷键 → 作用于该行的操作（与节点菜单、菜单栏相同）。 */
const rowCommands: ReadonlyArray<readonly [string, (chapterId: ChapterId) => void]> = [
  [SHORTCUTS.newChapter, requestCreateSibling],
  [SHORTCUTS.renameChapter, requestStartRename],
  [SHORTCUTS.moveChapterUp, (id) => requestMove(id, 'up')],
  [SHORTCUTS.moveChapterDown, (id) => requestMove(id, 'down')],
  [SHORTCUTS.outdentChapter, (id) => requestMove(id, 'outdent')],
  [SHORTCUTS.indentChapter, (id) => requestMove(id, 'indent')],
  [SHORTCUTS.deleteChapter, requestDelete],
]

/**
 * 树的键盘交互（ui-spec §29，WAI-ARIA tree 模式）：
 * ↑ / ↓ 选择上一 / 下一可见章节，Home / End 到首 / 末；
 * → 展开，已展开时进入第一个子章节；← 折叠，已折叠或无子章节时回到父章节；
 * h / j / k / l 等同 ← / ↓ / ↑ / →（vim 的移动键）；
 * Enter 进入正文；⌘N 在其后新建同级章节；⌘↩ 重命名；⌘↑ / ⌘↓ 上移 / 下移；⌘← / ⌘→ 升级 / 降级；
 * ⌘⌫ 请求删除（空章节直接删除，其余先确认，ui-spec §23）；Shift+F10 / 菜单键 打开节点菜单。快捷键来自 common/shortcuts.ts。
 * 单独的 Delete / Backspace 不删除章节，避免误删（ui-spec §29）。
 */
function onLabelKeydown(event: KeyboardEvent, row: ChapterRow): void {
  // Shift+F10 / 菜单键：打开该章节的菜单（与右键相同）。
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    event.preventDefault()
    openMenuFromKeyboard(row, event.currentTarget as HTMLElement)
    return
  }
  const command = rowCommands.find(([shortcut]) => matchesShortcut(event, shortcut))
  if (command) {
    event.preventDefault()
    command[1](row.id)
    return
  }
  if (event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) return

  const index = rows.value.findIndex((candidate) => candidate.id === row.id)
  const expanded = row.hasChildren && !collapsedIds.value.has(row.id)
  let target: ChapterId | null = null

  switch (VIM_KEYS[event.key] ?? event.key) {
    case 'ArrowUp':
      target = rows.value[index - 1]?.id ?? null
      break
    case 'ArrowDown':
      target = rows.value[index + 1]?.id ?? null
      break
    case 'Home':
      target = rows.value[0]?.id ?? null
      break
    case 'End':
      target = rows.value[rows.value.length - 1]?.id ?? null
      break
    case 'ArrowRight':
      if (row.hasChildren && !expanded) toggle(row.id)
      else if (expanded) target = rows.value[index + 1]?.id ?? null
      break
    case 'ArrowLeft':
      if (expanded) toggle(row.id)
      else target = parentOf(row.id)
      break
    case 'Enter':
      event.preventDefault()
      if (row.id !== props.selectedId) emit('select', row.id)
      emit('open', row.id)
      return
    default:
      return
  }
  event.preventDefault()
  if (target !== null) selectAndFocus(target)
}

const {
  draft,
  setInput: setRenameInput,
  commit: commitRename,
  finishByKey: finishRenameByKey,
} = useInlineRename({
  editingId: () => props.editingId,
  titleOf: (chapterId) => findChapter(props.tree, chapterId)?.title ?? '',
  onRename: (chapterId, title) => emit('rename', chapterId, title),
  onCancel: () => emit('cancel-rename'),
  focusRow: (chapterId) => void focusRow(chapterId),
})

const rows = computed<ChapterRow[]>(() => visibleRows(props.tree, collapsedIds.value))
const numberWidth = computed(() => numberWidths(rows.value))

const scrollElement = ref<HTMLElement | null>(null)

/** 章节很多时只渲染滚动区域附近的行（use_row_window.ts）；焦点、选中、重命名、拖拽与菜单的行始终保留。 */
const { virtual, rendered, rowHeight } = useRowWindow({
  rows: () => rows.value,
  scroller: scrollElement,
  pinned: () => [props.selectedId, tabbableId.value, props.editingId, draggingId.value, menuTarget.value?.id],
})

function nodeStyle(index: number): Record<string, string> | undefined {
  return virtual.value ? { position: 'absolute', top: `${index * rowHeight.value}px`, left: '0', right: '0' } : undefined
}

function numberStyle(row: ChapterRow): { minWidth: string } {
  return { minWidth: numberWidth.value.get(row.id) ?? '0' }
}

const emptyAction = ref<HTMLButtonElement | null>(null)

/**
 * 从别处（正文、⌘J）进入章节树：焦点放到可 Tab 聚焦的行（通常是当前章节，祖先已展开），
 * 并滚动到可见处；没有章节时放到"新建第一个章节"。
 */
async function focusCurrent(): Promise<void> {
  const id = tabbableId.value
  if (id === null) {
    emptyAction.value?.focus()
    return
  }
  await focusRow(id)
  listElement.value
    ?.querySelector<HTMLElement>(`.chapter-tree__label[data-chapter-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView?.({ block: 'nearest' })
}

defineExpose({
  /** 把键盘焦点放到某个章节行（如删除确认关闭后）。 */
  focusRow,
  focusCurrent,
  /** 上移 / 下移 / 升级 / 降级（菜单栏）：与快捷键相同，移动后焦点留在该章节。 */
  moveChapter: requestMove,
  openFocusedMenu,
})
</script>

<template>
  <div class="chapter-tree" @dragover="autoScroll">
    <div class="chapter-tree__header">
      <span class="chapter-tree__header-title">章节</span>
      <button
        type="button"
        class="chapter-tree__add"
        tabindex="0"
        aria-label="新建章节"
        title="新建章节"
        @click="requestCreateRoot"
      >
        <Icon name="plus" />
      </button>
    </div>

    <div ref="scrollElement" class="chapter-tree__scroll" @click.capture="focusFromPointer">
      <ul
        ref="listElement"
        class="chapter-tree__list"
        role="tree"
        aria-label="章节树"
        :style="virtual ? { position: 'relative', height: `${rows.length * rowHeight}px` } : undefined"
      >
        <li
          v-for="{ row, index } in rendered"
          :key="row.id"
          class="chapter-tree__node"
          :style="nodeStyle(index)"
          role="treeitem"
          :aria-level="row.depth + 1"
          :aria-selected="row.id === selectedId"
          :aria-expanded="row.hasChildren ? !collapsedIds.has(row.id) : undefined"
        >
          <div
            class="chapter-tree__row"
            :draggable="row.id !== editingId"
            :class="[
              { 'chapter-tree__row--selected': row.id === selectedId },
              { 'chapter-tree__row--dragging': row.id === draggingId },
              { 'chapter-tree__row--dragging-child': row.id !== draggingId && draggingIds.has(row.id) },
              { 'chapter-tree__row--menu-target': menuTarget !== null && menuTarget.context && menuTarget.id === row.id },
              { 'chapter-tree__row--settled': row.id === settledId },
              dropClass(row.id),
            ]"
            :data-depth="row.depth"
            :style="{ paddingLeft: rowPadding(row.depth) }"
            :aria-current="row.id === selectedId ? 'true' : undefined"
            @click="emit('select', row.id)"
            @contextmenu="openContextMenu($event, row)"
            @dragstart="startDrag($event, row)"
            @dragover="dragOverRow($event, row)"
            @dragleave="leaveRow($event, row.id)"
            @drop.prevent="drop"
            @dragend="endDrag"
          >
            <template v-if="rowDropTarget(row.id)">
              <span
                v-if="rowDropTarget(row.id)!.position !== 'inside'"
                class="chapter-tree__drop-line"
                :class="`chapter-tree__drop-line--${rowDropTarget(row.id)!.position}`"
                :style="{ left: lineLeft(row.depth) }"
              ></span>
              <span
                v-if="dropNumber"
                class="chapter-tree__drop-badge"
                :class="`chapter-tree__drop-badge--${rowDropTarget(row.id)!.position}`"
              >→ {{ dropNumber }}</span>
            </template>

            <button
              v-if="row.hasChildren"
              type="button"
              class="chapter-tree__toggle"
              tabindex="-1"
              :aria-expanded="!collapsedIds.has(row.id)"
              :aria-label="collapsedIds.has(row.id) ? '展开' : '折叠'"
              @click.stop="toggle(row.id)"
            >
              <Icon name="chevron-right" />
            </button>
            <span v-else class="chapter-tree__leaf-spacer" aria-hidden="true"></span>

            <div v-if="row.id === editingId" class="chapter-tree__edit" @click.stop>
              <span class="chapter-tree__number" :style="numberStyle(row)">{{ row.number }}</span>
              <input
                :ref="setRenameInput"
                class="chapter-tree__rename-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                aria-label="章节标题"
                :value="draft"
                @input="draft = ($event.target as HTMLInputElement).value"
                @keydown.enter.prevent="finishRenameByKey(true)"
                @keydown.esc.prevent="finishRenameByKey(false)"
                @blur="commitRename"
              />
            </div>
            <button
              v-else
              type="button"
              class="chapter-tree__label"
              :data-chapter-id="row.id"
              :tabindex="row.id === tabbableId ? 0 : -1"
              @dblclick="renameFromDoubleClick(row)"
              @focus="focusedId = row.id"
              @keydown="onLabelKeydown($event, row)"
            >
              <span class="chapter-tree__number" :style="numberStyle(row)">{{ row.number }}</span>
              <span class="chapter-tree__title" :title="row.title">{{ row.title }}</span>
              <span
                v-if="row.note"
                class="chapter-tree__note"
                :title="row.note"
                role="img"
                aria-label="有备注"
              ><Icon name="note" /></span>
              <span
                v-if="row.status"
                class="chapter-tree__status"
                :class="`chapter-tree__status--${row.status}`"
                role="img"
                :aria-label="STATUS_LABELS[row.status]"
                :title="STATUS_LABELS[row.status]"
              ></span>
            </button>

            <button
              v-if="row.id !== editingId"
              type="button"
              class="chapter-tree__more"
              :class="{ 'chapter-tree__more--open': openMenuId === row.id && !menuTarget?.context }"
              aria-label="更多操作"
              aria-haspopup="menu"
              :aria-expanded="openMenuId === row.id"
              :tabindex="row.id === tabbableId ? 0 : -1"
              @click.stop="toggleMenu(row.id, $event)"
            >
              <Icon name="more" />
            </button>
          </div>
        </li>
      </ul>

      <div v-if="tree.length === 0" class="chapter-tree__empty">
        <p class="chapter-tree__empty-text">暂无章节</p>
        <button
          ref="emptyAction"
          type="button"
          class="chapter-tree__empty-action"
          tabindex="0"
          @click="requestCreateRoot"
        >
          <Icon name="plus" />
          新建第一个章节
        </button>
      </div>
      <!-- 树下方的空白：拖到这里成为最后一个一级章节。 -->
      <div v-else class="chapter-tree__tail" @dragover="dragOverTail" @dragleave="leaveTail" @drop.prevent="drop">
        <template v-if="dropTarget?.zone === 'tail'">
          <span class="chapter-tree__drop-line chapter-tree__drop-line--tail" :style="{ left: lineLeft(0) }"></span>
          <span v-if="dropNumber" class="chapter-tree__drop-badge chapter-tree__drop-badge--tail">→ {{ dropNumber }}</span>
        </template>
      </div>
    </div>

    <PopupMenu
      v-if="menu.current.value"
      label="章节操作"
      menu-class="chapter-tree__menu"
      backdrop-class="chapter-tree__backdrop"
      :items="menu.current.value.entries"
      :anchor="menu.current.value.anchor"
      :keyboard="menu.current.value.keyboard"
      @select="menu.select"
      @close="closeMenu"
    />
  </div>
</template>

<style scoped>
/*
 * 尺寸遵循 ui-spec：行高 32px（§2）、每级缩进 16px（§3）、箭头点击区域 20×20（§4）、
 * 标题 14px / 编号 13px / Tree Header 13px medium（§32）。颜色与动画来自 ui/tokens.css。
 */
.chapter-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: var(--text-l);
}

.chapter-tree__header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  height: var(--tree-row-h);
  padding: 0 var(--space-4) 0 14px;
}

.chapter-tree__header-title {
  color: var(--color-text-secondary);
  font-size: var(--text-m);
  font-weight: var(--weight-medium);
}

.chapter-tree__add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-s);
  height: var(--control-h-s);
  padding: 0;
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--color-text-tertiary);
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.chapter-tree__add:hover {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.chapter-tree__add:active {
  background: var(--color-fill-pressed);
}

/* 章节树自身滚动（§27）；拖拽时的自动滚动也作用在这里。 */
.chapter-tree__scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--space-4);
}

.chapter-tree__list {
  flex: none;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chapter-tree__row {
  position: relative;
  display: flex;
  align-items: center;
  height: var(--tree-row-h);
  box-sizing: border-box;
  padding-right: var(--space-2);
  border-radius: var(--radius-m);
  color: var(--color-text);
  transition: background-color 120ms var(--ease-out), opacity var(--duration-base) var(--ease-out);
}

.chapter-tree__row:hover {
  background: var(--color-fill-hover);
}

/* 选中：浅底 + 左侧强调条 + 标题稍加重（§9）；hover 时保持同样的主视觉（§10）。 */
.chapter-tree__row--selected,
.chapter-tree__row--selected:hover {
  background: var(--color-accent-fill);
}

.chapter-tree__row--selected::before {
  position: absolute;
  top: 7px;
  bottom: 7px;
  left: 0;
  width: 3px;
  border-radius: 0 2px 2px 0;
  content: '';
  background: var(--color-accent);
}

.chapter-tree__row--selected .chapter-tree__title {
  font-weight: var(--weight-medium);
}

.chapter-tree__row--selected .chapter-tree__number {
  color: var(--color-text-secondary);
}

/*
 * 章节树没有获得焦点（在正文中写作）时，选中行改为灰色（macOS 侧栏的"非活动"选中）：
 * 仍然一眼看出当前章节，同时说明键盘不在这里。焦点回到树中时恢复强调色。
 */
.chapter-tree__list:not(:focus-within) .chapter-tree__row--selected {
  background: var(--color-fill-pressed);
}

.chapter-tree__list:not(:focus-within) .chapter-tree__row--selected::before {
  background: var(--color-text-tertiary);
}

/* 键盘焦点：整行内描边，与选中态（底色 + 强调条）区分（§30）。 */
.chapter-tree__row:has(.chapter-tree__label:focus-visible) {
  box-shadow: inset 0 0 0 2px var(--color-focus-ring);
}

/* 右键菜单作用的行：不改变选中，只描边。 */
.chapter-tree__row--menu-target {
  box-shadow: inset 0 0 0 1.5px var(--color-accent);
}

/* 拖动中的源节点留在原处、变淡（§12）；它的子章节随它移动，也一起变淡。 */
.chapter-tree__row--dragging,
.chapter-tree__row--dragging-child {
  opacity: 0.4;
}

/* inside：整行高亮，表示成为它的子章节（§14.2）。 */
.chapter-tree__row--drop-inside,
.chapter-tree__row--drop-inside:hover {
  background: var(--color-accent-fill-strong);
  box-shadow: inset 0 0 0 1.5px var(--color-accent);
}

/* 刚被移动的章节短暂高亮新位置，然后淡出。 */
.chapter-tree__row--settled {
  animation: chapter-tree-settle 900ms var(--ease-out);
}

@keyframes chapter-tree-settle {
  from {
    background-color: var(--color-accent-fill-strong);
  }
}

/* before / after：插入线从落点层级的编号处开始（§16），起点带一个小圆圈，跨在两行之间。 */
.chapter-tree__drop-line {
  position: absolute;
  right: var(--space-2);
  z-index: 2;
  height: 2px;
  border-radius: 1px;
  background: var(--color-accent);
  pointer-events: none;
}

.chapter-tree__drop-line::before {
  position: absolute;
  top: -3px;
  left: -6px;
  width: 4px;
  height: 4px;
  border: 2px solid var(--color-accent);
  border-radius: 50%;
  content: '';
  background: var(--color-bg-sidebar);
}

.chapter-tree__drop-line--before {
  top: -1px;
}

.chapter-tree__drop-line--after {
  bottom: -1px;
}

.chapter-tree__drop-line--tail {
  top: -1px;
}

/* 松手后的新编号：跟在插入线 / 高亮行的右端。 */
.chapter-tree__drop-badge {
  position: absolute;
  right: var(--space-2);
  z-index: 3;
  height: 18px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-s);
  background: var(--color-accent);
  color: var(--color-text-on-accent);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  white-space: nowrap;
  pointer-events: none;
}

.chapter-tree__drop-badge--before,
.chapter-tree__drop-badge--tail {
  top: -10px;
}

.chapter-tree__drop-badge--after {
  bottom: -10px;
}

.chapter-tree__drop-badge--inside {
  top: 7px;
}

.chapter-tree__toggle {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--tree-toggle);
  height: var(--tree-toggle);
  padding: 0;
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--color-text-tertiary);
}

.chapter-tree__toggle:hover {
  background: var(--color-fill-pressed);
  color: var(--color-text-secondary);
}

/* 同一个箭头：折叠时指向右（›），展开时旋转向下（▾），不换字形、不跳动。 */
.chapter-tree__toggle .icon {
  width: var(--icon-s);
  height: var(--icon-s);
  stroke-width: 1.6;
  transition: transform 120ms var(--ease-out);
}

.chapter-tree__toggle[aria-expanded='true'] .icon {
  transform: rotate(90deg);
}

.chapter-tree__leaf-spacer {
  flex: none;
  /* 与箭头等宽的占位，保证叶子节点标题对齐。 */
  width: var(--tree-toggle);
  height: var(--tree-toggle);
}

.chapter-tree__label {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: var(--space-4);
  min-width: 0;
  height: 100%;
  padding: 0 0 0 var(--space-1);
  border: none;
  background: none;
  color: inherit;
  /* 按钮不继承字号：显式使用 §32 的 14px。 */
  font: inherit;
  font-size: var(--text-l);
  line-height: var(--tree-row-h);
  text-align: left;
}

.chapter-tree__label:focus-visible {
  outline: none;
}

.chapter-tree__number {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--text-m);
  font-variant-numeric: tabular-nums;
}

/* 标题单行截断，树高与拖拽目标尺寸保持稳定（§6）。 */
.chapter-tree__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ···：默认隐藏；hover、选中、菜单打开、获得键盘焦点时显示（§7、§8、§24）。 */
/* 写作状态：标题后的小圆点（草稿空心、待修改橙色、完成绿色）；备注：小图标。都不抢标题的视线。 */
.chapter-tree__status {
  flex: none;
  width: 7px;
  height: 7px;
  margin-left: var(--space-1);
  box-sizing: border-box;
  border-radius: 50%;
}

.chapter-tree__status--draft {
  border: 1.5px solid var(--color-text-tertiary);
}

.chapter-tree__status--revise {
  background: var(--color-status-revise);
}

.chapter-tree__status--done {
  background: var(--color-status-done);
}

.chapter-tree__note {
  display: flex;
  flex: none;
  color: var(--color-text-tertiary);
}

.chapter-tree__note .icon {
  width: var(--icon-s);
  height: var(--icon-s);
}

.chapter-tree__row--selected .chapter-tree__note {
  color: inherit;
  opacity: 0.7;
}

.chapter-tree__more {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--control-h-s);
  height: var(--control-h-s);
  padding: 0;
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--color-text-tertiary);
  opacity: 0;
  transition: opacity 120ms var(--ease-out);
}

.chapter-tree__more .icon {
  stroke-width: 2;
}

.chapter-tree__row:hover .chapter-tree__more,
.chapter-tree__row--selected .chapter-tree__more,
.chapter-tree__more--open,
.chapter-tree__more:focus-visible {
  opacity: 1;
}

.chapter-tree__more:hover,
.chapter-tree__more--open {
  background: var(--color-fill-pressed);
  color: var(--color-text);
}

/* 拖拽时不显示 ···，反馈只来自插入线与高亮。 */
.chapter-tree__row--dragging .chapter-tree__more,
.chapter-tree__list:has(.chapter-tree__row--dragging) .chapter-tree__more {
  opacity: 0;
}

.chapter-tree__edit {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  padding-left: var(--space-1);
}

/* 输入框的文字与标题原来的位置对齐：进入编辑时文字不移动（§19）。 */
.chapter-tree__rename-input {
  flex: 1;
  min-width: 0;
  height: var(--control-h-s);
  margin: 0 0 0 calc(-1 * var(--space-2) - 1px);
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-s);
  background: var(--color-bg);
  box-shadow: 0 0 0 1px var(--color-accent), 0 0 0 3px var(--color-accent-fill-strong);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-l);
  outline: none;
}

.chapter-tree__tail {
  position: relative;
  flex: 1 0 var(--tree-row-h);
}

.chapter-tree__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-9) var(--space-4);
}

.chapter-tree__empty-text {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-m);
}

.chapter-tree__empty-action {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-m);
  padding: 0 var(--space-5) 0 var(--space-4);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-m);
}

.chapter-tree__empty-action .icon {
  width: var(--icon-s);
  height: var(--icon-s);
}

.chapter-tree__empty-action:hover {
  background: var(--color-fill-pressed);
}
</style>
