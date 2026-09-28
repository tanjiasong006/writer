<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { findChapter, type ChapterId, type ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { autoScrollStep, resolveDropPosition, type DropPosition } from './drop_target.ts'
import {
  canMoveChapter,
  keyboardMoveIntent,
  moveChapterTo,
  type KeyboardMoveDirection,
  type MoveIntent,
} from '../../application/move_chapter.ts'
import PopupMenu, { type MenuAnchor, type MenuEntry } from '../common/PopupMenu.vue'
import Icon from '../common/Icon.vue'

/**
 * 章节树组件。
 *
 * 负责：按 tree 渲染层级、选择、折叠/展开、拖拽落点反馈、Tree Header、
 * 节点菜单与右键菜单、F2 内联重命名、键盘导航与键盘移动、空状态。
 *
 * 拖拽反馈除了 before / inside / after 的插入线与高亮，还显示松手后章节的新编号：
 * 编号由 Application 的 moveChapterTo 在当前树的副本上执行同一次移动得到，UI 不推算结构。
 *
 * 所有会产生结构变化的行为都只发出意图事件，由上层（Application）执行；
 * 组件不判断移动是否合法、不构造新树，也不包含任何章节结构规则。
 * 折叠、菜单、正在编辑的章节都是纯 UI 状态，不回写 tree。
 */

const props = defineProps<{
  /** 要渲染的章节树；调用方保证是已校验的可信树。 */
  tree: ChapterTree
  /** 当前选中的章节 id；仅用于显示选中态。 */
  selectedId?: ChapterId | null
  /** 正在内联重命名的章节 id；由上层在新建后或用户触发时设置。 */
  editingId?: ChapterId | null
  /** 正在重命名的是刚新建的章节：按 Enter 确认标题后直接进入正文（发出 open），可以马上开始写。 */
  editingNew?: boolean
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
  /** 请求进入重命名编辑（F2 / 菜单）。 */
  'start-rename': [chapterId: ChapterId]
  /** 内联重命名提交新标题。 */
  rename: [chapterId: ChapterId, title: string]
  /** 放弃本次重命名。 */
  'cancel-rename': []
  /** 请求删除章节，由上层决定是否确认。 */
  delete: [chapterId: ChapterId]
  /** Enter：进入当前章节的正文编辑（包括为新章节确认标题后）。 */
  open: [chapterId: ChapterId]
}>()

interface ChapterRow {
  readonly id: ChapterId
  readonly title: string
  readonly number: string
  readonly depth: number
  readonly hasChildren: boolean
}

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

/** 被拖动的章节及其所有子章节：它们会一起移动，因此一起变淡。 */
const draggingIds = computed<ReadonlySet<ChapterId>>(() => {
  const ids = new Set<ChapterId>()
  const node = draggingId.value === null ? null : findChapter(props.tree, draggingId.value)
  const collect = (current: { readonly id: ChapterId; readonly children: ChapterTree }) => {
    ids.add(current.id)
    for (const child of current.children) collect(child)
  }
  if (node) collect(node)
  return ids
})

/**
 * 当前落点：目标章节 id 与相对位置；离开有效目标后清空。
 * zone 为 tail 表示树下方的空白区域：放到最后一个根章节之后（成为最后一个一级章节）。
 */
interface DropTarget {
  readonly id: ChapterId
  readonly position: DropPosition
  readonly zone: 'row' | 'tail'
}
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
  const result = moveChapterTo(props.tree, { chapterId, targetChapterId: target.id, position: target.position })
  if (!result.ok) return null
  return (computeChapterNumbers(result.tree).get(chapterId) ?? []).join('.')
})

function startDrag(event: DragEvent, row: ChapterRow): void {
  closeMenu()
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
  let node = listElement.value?.parentElement ?? null
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

/** 拖到折叠章节的 inside 区域并停留时自动展开它（ui-spec §18）。 */
const EXPAND_DELAY_MS = 600
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
    if (draggingId.value !== null && collapsedIds.value.has(chapterId)) toggle(chapterId)
  }, EXPAND_DELAY_MS)
}

/**
 * 有效落点时接受放下（preventDefault）并显示反馈；无效落点（自身、自身后代、不会产生位移的位置）
 * 不接受，系统显示"不可放下"的光标，也不显示任何插入线（ui-spec §17）。
 */
function dragOverRow(event: DragEvent, row: ChapterRow): void {
  const dragging = draggingId.value
  if (dragging === null) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const position = resolveDropPosition(event.clientY, { top: rect.top, height: rect.height })
  const intent: MoveIntent = { chapterId: dragging, targetChapterId: row.id, position }
  if (row.id === dragging || !canMoveChapter(props.tree, intent)) {
    setDropTarget(null)
    scheduleExpand(null)
    return
  }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  setDropTarget({ id: row.id, position, zone: 'row' })
  scheduleExpand(position === 'inside' && row.hasChildren && collapsedIds.value.has(row.id) ? row.id : null)
}

/** 树下方的空白区域：放到最后一个根章节之后。 */
function dragOverTail(event: DragEvent): void {
  const dragging = draggingId.value
  const last = props.tree[props.tree.length - 1]
  scheduleExpand(null)
  if (dragging === null || last === undefined) return
  const intent: MoveIntent = { chapterId: dragging, targetChapterId: last.id, position: 'after' }
  if (last.id === dragging || !canMoveChapter(props.tree, intent)) {
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

/** 松手：有有效落点时发一个 move 意图，然后一律清空拖拽状态。 */
function drop(): void {
  const target = dropTarget.value
  const chapterId = draggingId.value
  if (chapterId !== null && target !== null) {
    emit('move', { chapterId, targetChapterId: target.id, position: target.position })
    markSettled(chapterId)
  }
  endDrag()
}

/** 松手或拖拽结束都清空拖拽状态；本组件不修改 tree。 */
function endDrag(): void {
  draggingId.value = null
  setDropTarget(null)
  scheduleExpand(null)
}

onBeforeUnmount(() => {
  if (expandTimer !== null) clearTimeout(expandTimer)
  if (settleTimer !== null) clearTimeout(settleTimer)
})

function rowDropTarget(chapterId: ChapterId): DropTarget | null {
  const target = dropTarget.value
  return target !== null && target.zone === 'row' && target.id === chapterId ? target : null
}

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

/** 点击标题：选中由行 click 冒泡处理，这里只对有子章节的节点补上展开/收起。 */
function toggleFromTitle(row: ChapterRow): void {
  if (row.hasChildren) toggle(row.id)
}

/**
 * 节点菜单（··· 按钮、右键、Shift+F10 / 菜单键）。同一时间只有一个菜单。
 * 右键打开时不改变选中章节，只用描边标出菜单作用的行（桌面文件列表的习惯）。
 */
interface OpenMenu {
  readonly id: ChapterId
  readonly anchor: MenuAnchor
  readonly keyboard: boolean
  readonly context: boolean
}
const menu = shallowRef<OpenMenu | null>(null)
const openMenuId = computed(() => menu.value?.id ?? null)

function toggleMenu(chapterId: ChapterId, event: MouseEvent): void {
  if (menu.value?.id === chapterId && !menu.value.context) {
    closeMenu()
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // 由键盘（Enter / Space）触发的 click 没有点击次数：菜单打开后第一项获得焦点。
  menu.value = { id: chapterId, anchor: { rect, align: 'end' }, keyboard: event.detail === 0, context: false }
}

function openContextMenu(event: MouseEvent, row: ChapterRow): void {
  if (row.id === props.editingId) return
  menu.value = { id: row.id, anchor: { x: event.clientX, y: event.clientY }, keyboard: false, context: true }
}

function openMenuFromKeyboard(row: ChapterRow, target: HTMLElement): void {
  const rect = target.getBoundingClientRect()
  menu.value = { id: row.id, anchor: { rect, align: 'start' }, keyboard: true, context: true }
}

function closeMenu(): void {
  menu.value = null
}

function menuItems(chapterId: ChapterId): MenuEntry[] {
  return [
    { id: 'create-sibling', label: '新建同级章节' },
    { id: 'create-child', label: '新建子章节' },
    { separator: true },
    ...MOVE_ITEMS.map((item) => ({
      id: `move-${item.direction}`,
      label: item.label,
      shortcut: `${moveShortcut}${item.key}`,
      disabled: !canMoveBy(chapterId, item.direction),
    })),
    { separator: true },
    { id: 'rename', label: '重命名', shortcut: 'F2' },
    { id: 'delete', label: '删除' },
  ]
}

function onMenuSelect(action: string): void {
  const chapterId = menu.value?.id
  if (chapterId === undefined) return
  if (action === 'create-sibling') requestCreateSibling(chapterId)
  else if (action === 'create-child') requestCreateChild(chapterId)
  else if (action === 'rename') requestStartRename(chapterId)
  else if (action === 'delete') requestDelete(chapterId)
  else if (action.startsWith('move-')) requestMove(chapterId, action.slice('move-'.length) as KeyboardMoveDirection)
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

function selectAndFocus(chapterId: ChapterId): void {
  if (chapterId !== props.selectedId) emit('select', chapterId)
  void focusRow(chapterId)
}

/** 从根到 id 的父章节 id；根章节或找不到时为 null。 */
function parentOf(chapterId: ChapterId): ChapterId | null {
  const path = ancestorPath(props.tree, chapterId)
  return path === null || path.length === 0 ? null : path[path.length - 1]
}

/** 菜单中的移动项；快捷键与键盘操作一致（Alt / ⌥ + Shift + 方向键）。 */
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const moveShortcut = isMac ? '⌥⇧' : 'Alt+Shift+'
const MOVE_ITEMS: ReadonlyArray<{ direction: KeyboardMoveDirection; label: string; key: string }> = [
  { direction: 'up', label: '上移', key: '↑' },
  { direction: 'down', label: '下移', key: '↓' },
  { direction: 'outdent', label: '升级', key: '←' },
  { direction: 'indent', label: '降级', key: '→' },
]

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

const MOVE_KEYS: Readonly<Record<string, KeyboardMoveDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'outdent',
  ArrowRight: 'indent',
}

/**
 * 树的键盘交互（ui-spec §29，WAI-ARIA tree 模式）：
 * ↑ / ↓ 选择上一 / 下一可见章节，Home / End 到首 / 末；
 * → 展开，已展开时进入第一个子章节；← 折叠，已折叠或无子章节时回到父章节；
 * Enter 进入正文；F2 重命名；Alt+Shift+方向键 移动章节（上移 / 下移 / 提升 / 降级）；
 * Shift+F10 / 菜单键 打开节点菜单。
 * Delete 不删除章节，避免误删。
 */
function onLabelKeydown(event: KeyboardEvent, row: ChapterRow): void {
  // Shift+F10 / 菜单键：打开该章节的菜单（与右键相同）。
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    event.preventDefault()
    openMenuFromKeyboard(row, event.currentTarget as HTMLElement)
    return
  }
  if (event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey) {
    const direction = MOVE_KEYS[event.key]
    if (direction === undefined) return
    event.preventDefault()
    requestMove(row.id, direction)
    return
  }
  if (event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) return

  const index = rows.value.findIndex((candidate) => candidate.id === row.id)
  const expanded = row.hasChildren && !collapsedIds.value.has(row.id)
  let target: ChapterId | null = null

  switch (event.key) {
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
    case 'F2':
      event.preventDefault()
      requestStartRename(row.id)
      return
    default:
      return
  }
  event.preventDefault()
  if (target !== null) selectAndFocus(target)
}

/** 内联重命名的临时文本；由 editingId 驱动初始化。 */
const draft = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
/** 本次编辑是否已结束，避免 Esc 触发卸载后 blur 再次提交。 */
let renameDone = false

function setRenameInput(element: Element | { $el?: Element } | null): void {
  renameInput.value = (element as HTMLInputElement | null) ?? null
}

async function focusRenameInput(): Promise<void> {
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

watch(
  () => props.editingId,
  (id) => {
    renameDone = false
    if (id === null || id === undefined) {
      draft.value = ''
      return
    }
    draft.value = findChapter(props.tree, id)?.title ?? ''
    void focusRenameInput()
  },
  { immediate: true },
)

/** Enter / 失焦提交；空标题视为放弃，避免标题变空。 */
function commitRename(): void {
  const id = props.editingId
  if (id === null || id === undefined || renameDone) return
  renameDone = true
  const title = draft.value.trim()
  if (title.length === 0) emit('cancel-rename')
  else emit('rename', id, title)
}

function cancelRename(): void {
  if (renameDone) return
  renameDone = true
  emit('cancel-rename')
}

/**
 * 用键盘结束重命名（Enter 确认 / Esc 放弃）：输入框随之消失，焦点回到该章节所在行，不会掉到页面上；
 * 新章节按 Enter 确认标题后进入正文。失焦提交时焦点已经在别处，不再移动。
 */
function finishRenameByKey(submit: boolean): void {
  const id = props.editingId
  if (id === null || id === undefined || renameDone) return
  if (submit) commitRename()
  else cancelRename()
  if (submit && props.editingNew) emit('open', id)
  else void focusRow(id)
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

defineExpose({
  /** 把键盘焦点放到某个章节行（如删除确认关闭后）。 */
  focusRow,
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

    <div class="chapter-tree__scroll">
      <ul ref="listElement" class="chapter-tree__list" role="tree" aria-label="章节树">
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
            :draggable="row.id !== editingId"
            :class="[
              { 'chapter-tree__row--selected': row.id === selectedId },
              { 'chapter-tree__row--dragging': row.id === draggingId },
              { 'chapter-tree__row--dragging-child': row.id !== draggingId && draggingIds.has(row.id) },
              { 'chapter-tree__row--menu-target': menu !== null && menu.context && menu.id === row.id },
              { 'chapter-tree__row--settled': row.id === settledId },
              dropClass(row.id),
            ]"
            :data-depth="row.depth"
            :style="{ paddingLeft: rowPadding(row.depth) }"
            :aria-current="row.id === selectedId ? 'true' : undefined"
            @click="emit('select', row.id)"
            @contextmenu.prevent="openContextMenu($event, row)"
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
              <span class="chapter-tree__number">{{ row.number }}</span>
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
              @click="toggleFromTitle(row)"
              @focus="focusedId = row.id"
              @keydown="onLabelKeydown($event, row)"
            >
              <span class="chapter-tree__number">{{ row.number }}</span>
              <span class="chapter-tree__title" :title="row.title">{{ row.title }}</span>
            </button>

            <button
              v-if="row.id !== editingId"
              type="button"
              class="chapter-tree__more"
              :class="{ 'chapter-tree__more--open': openMenuId === row.id && !menu?.context }"
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
        <button type="button" class="chapter-tree__empty-action" tabindex="0" @click="requestCreateRoot">
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
      v-if="menu"
      label="章节操作"
      menu-class="chapter-tree__menu"
      backdrop-class="chapter-tree__backdrop"
      :items="menuItems(menu.id)"
      :anchor="menu.anchor"
      :keyboard="menu.keyboard"
      @select="onMenuSelect"
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
