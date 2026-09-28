<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { findChapter, type ChapterId, type ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { resolveDropPosition, type DropPosition } from './drop_target.ts'
import {
  canMoveChapter,
  keyboardMoveIntent,
  type KeyboardMoveDirection,
  type MoveIntent,
} from '../../application/move_chapter.ts'

/**
 * 章节树组件。
 *
 * 负责：按 tree 渲染层级、选择、折叠/展开、拖拽落点反馈、Tree Header、
 * 节点菜单、F2 内联重命名、键盘导航与键盘移动、空状态。
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
  /** Enter：进入当前章节的正文编辑。 */
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

/** 当前落点：命中行 id 与相对位置；离开有效目标后清空。 */
const dropTarget = ref<{ readonly id: ChapterId; readonly position: DropPosition } | null>(null)

function startDrag(event: DragEvent, row: ChapterRow): void {
  draggingId.value = row.id
  dropTarget.value = null
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) return
  dataTransfer.effectAllowed = 'move'
  if (typeof dataTransfer.setDragImage !== 'function') return
  // Drag Preview 只带编号 + 标题的轻量浮层，不复制整行节点 UI。
  const preview = document.createElement('div')
  preview.textContent = `${row.number} ${row.title}`
  Object.assign(preview.style, {
    position: 'fixed',
    top: '-1000px',
    left: '-1000px',
    padding: '4px 10px',
    background: '#ffffff',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
    fontSize: '13px',
    color: '#111827',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  })
  document.body.appendChild(preview)
  dataTransfer.setDragImage(preview, 10, 16)
  // 浏览器已同步读取图像，下一帧移除即可。
  window.setTimeout(() => preview.remove(), 0)
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

/** 点击标题：选中由行 click 冒泡处理，这里只对有子章节的节点补上展开/收起。 */
function toggleFromTitle(row: ChapterRow): void {
  if (row.hasChildren) toggle(row.id)
}

/** 当前打开菜单的章节 id；同一时间只允许一个菜单。 */
const openMenuId = ref<ChapterId | null>(null)
/** 下方空间不够时菜单向上展开，避免被窗口底部裁切。 */
const menuUp = ref(false)
/** 节点菜单的大致高度（10 项 + 分隔线）。 */
const MENU_HEIGHT = 340

function toggleMenu(chapterId: ChapterId, event?: MouseEvent): void {
  if (openMenuId.value === chapterId) {
    openMenuId.value = null
    return
  }
  const rect = (event?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect()
  menuUp.value =
    rect !== undefined && window.innerHeight - rect.bottom < MENU_HEIGHT && rect.top > MENU_HEIGHT
  openMenuId.value = chapterId
}

function closeMenu(): void {
  openMenuId.value = null
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
 * Enter 进入正文；F2 重命名；Alt+Shift+方向键 移动章节（上移 / 下移 / 提升 / 降级）。
 * Delete 不删除章节，避免误删。
 */
function onLabelKeydown(event: KeyboardEvent, row: ChapterRow): void {
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
  <div class="chapter-tree">
    <div class="chapter-tree__header">
      <span class="chapter-tree__header-title">章节</span>
      <button
        type="button"
        class="chapter-tree__add"
        aria-label="新建章节"
        @click="requestCreateRoot"
      >
        +
      </button>
    </div>

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
          draggable="true"
          :class="[
            { 'chapter-tree__row--selected': row.id === selectedId },
            { 'chapter-tree__row--dragging': row.id === draggingId },
            dropClass(row.id),
          ]"
          :data-depth="row.depth"
          :style="{ paddingLeft: `${row.depth * 16}px` }"
          :aria-current="row.id === selectedId ? 'true' : undefined"
          @click="emit('select', row.id)"
          @dragstart="startDrag($event, row)"
          @dragover.prevent="updateDropTarget($event, row.id)"
          @dragleave="leaveRow(row.id)"
          @drop.prevent="drop"
          @dragend="endDrag"
        >
          <span
            v-if="dropTarget && dropTarget.id === row.id && dropTarget.position !== 'inside'"
            class="chapter-tree__drop-line"
            :class="`chapter-tree__drop-line--${dropTarget.position}`"
            :style="{ left: `${row.depth * 16}px` }"
          ></span>
          <button
            v-if="row.hasChildren"
            type="button"
            class="chapter-tree__toggle"
            tabindex="-1"
            :aria-expanded="!collapsedIds.has(row.id)"
            :aria-label="collapsedIds.has(row.id) ? '展开' : '折叠'"
            @click.stop="toggle(row.id)"
          ></button>
          <span
            v-else
            class="chapter-tree__leaf-spacer"
            aria-hidden="true"
          ></span>

          <div v-if="row.id === editingId" class="chapter-tree__edit" @click.stop>
            <span class="chapter-tree__number">{{ row.number }}</span>
            <input
              :ref="setRenameInput"
              class="chapter-tree__rename-input"
              type="text"
              autocomplete="off"
              :value="draft"
              @input="draft = ($event.target as HTMLInputElement).value"
              @keydown.enter.prevent="commitRename"
              @keydown.esc.prevent="cancelRename"
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
            type="button"
            class="chapter-tree__more"
            :class="{ 'chapter-tree__more--open': openMenuId === row.id }"
            aria-label="更多操作"
            aria-haspopup="menu"
            :tabindex="row.id === tabbableId ? 0 : -1"
            @click.stop="toggleMenu(row.id, $event)"
          ></button>
        </div>

        <ul
          v-if="openMenuId === row.id"
          class="chapter-tree__menu"
          :class="{ 'chapter-tree__menu--up': menuUp }"
          role="menu"
          draggable="false"
          @click.stop
          @keydown.esc="closeMenu"
        >
          <li><button type="button" role="menuitem" @click="requestCreateSibling(row.id)">新建同级章节</button></li>
          <li><button type="button" role="menuitem" @click="requestCreateChild(row.id)">新建子章节</button></li>
          <li class="chapter-tree__menu-separator" role="separator"></li>
          <li v-for="item in MOVE_ITEMS" :key="item.direction">
            <button
              type="button"
              role="menuitem"
              :disabled="!canMoveBy(row.id, item.direction)"
              @click="requestMove(row.id, item.direction)"
            >
              {{ item.label }}<kbd class="chapter-tree__shortcut">{{ moveShortcut }}{{ item.key }}</kbd>
            </button>
          </li>
          <li class="chapter-tree__menu-separator" role="separator"></li>
          <li><button type="button" role="menuitem" @click="requestStartRename(row.id)">重命名</button></li>
          <li><button type="button" role="menuitem" @click="requestDelete(row.id)">删除</button></li>
        </ul>
      </li>
    </ul>

    <div v-if="tree.length === 0" class="chapter-tree__empty">
      <p class="chapter-tree__empty-text">暂无章节</p>
      <button type="button" class="chapter-tree__empty-action" @click="requestCreateRoot">
        + 新建第一个章节
      </button>
    </div>

    <div v-if="openMenuId !== null" class="chapter-tree__backdrop" @click="closeMenu"></div>
  </div>
</template>

<style scoped>
.chapter-tree {
  font-size: 14px;
}

.chapter-tree__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding-right: 4px;
}

.chapter-tree__header-title {
  font-size: 13px;
  font-weight: 500;
}

.chapter-tree__add {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: #6b7280;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.chapter-tree__add:hover {
  background: rgba(15, 23, 42, 0.08);
}

.chapter-tree__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.chapter-tree__node {
  position: relative;
}

.chapter-tree__row {
  position: relative;
  display: flex;
  align-items: center;
  /* P0 统一节点高度，拖拽目标尺寸稳定。 */
  height: 32px;
  transition: background 120ms ease;
}

.chapter-tree__row:hover {
  background: rgba(15, 23, 42, 0.05);
}

.chapter-tree__row--selected,
.chapter-tree__row--selected:hover {
  background: rgba(59, 130, 246, 0.1);
}

/* 左侧强调条让选中章节在长文写作时一眼可辨。 */
.chapter-tree__row--selected::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: #3b82f6;
}

/* 键盘焦点：整行内描边，与选中态（背景 + 左侧强调条）区分。 */
.chapter-tree__label:focus-visible {
  outline: none;
}

.chapter-tree__row:has(.chapter-tree__label:focus-visible) {
  box-shadow: inset 0 0 0 2px #93c5fd;
}

.chapter-tree__row--dragging {
  opacity: 0.5;
}

/* 插入线按最终层级缩进：before / after 是目标的同级。 */
.chapter-tree__drop-line {
  position: absolute;
  right: 0;
  height: 2px;
  background: #3b82f6;
  pointer-events: none;
}

.chapter-tree__drop-line--before {
  top: 0;
}

.chapter-tree__drop-line--after {
  bottom: 0;
}

.chapter-tree__row--drop-inside {
  background: rgba(59, 130, 246, 0.15);
}

.chapter-tree__toggle {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: #6b7280;
  font-size: 14px;
  line-height: 1;
}

.chapter-tree__toggle::before {
  content: '▾';
}

.chapter-tree__toggle[aria-expanded='false']::before {
  content: '›';
}

.chapter-tree__leaf-spacer {
  flex: none;
  /* 与箭头等宽的占位，保证叶子节点标题对齐。 */
  width: 20px;
  height: 20px;
}

.chapter-tree__label {
  flex: 1;
  /* 按钮不继承字号：显式使用 ui-spec §32 的 14px。 */
  font-size: 14px;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  text-align: left;
}

.chapter-tree__number {
  flex: none;
  color: #6b7280;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

/* 标题单行截断，树高与拖拽目标尺寸保持稳定。 */
.chapter-tree__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Hover / 选中 / 菜单打开时显示 ···，默认保持安静。 */
.chapter-tree__more {
  flex: none;
  width: 24px;
  height: 24px;
  margin-right: 2px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: #6b7280;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}

/* 用 CSS 呈现 ···，让行的可读文本只包含编号与标题。 */
.chapter-tree__more::before {
  content: '···';
}

.chapter-tree__row:hover .chapter-tree__more,
.chapter-tree__row--selected .chapter-tree__more,
.chapter-tree__more--open,
.chapter-tree__more:focus-visible {
  opacity: 1;
}

.chapter-tree__more:hover {
  background: rgba(15, 23, 42, 0.08);
}

.chapter-tree__edit {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.chapter-tree__rename-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid #93c5fd;
  border-radius: 4px;
  background: #ffffff;
  color: #111827;
  font: inherit;
  font-size: 14px;
  outline: none;
}

.chapter-tree__menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 20;
  min-width: 11rem;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: #ffffff;
  color: #111827;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
}

.chapter-tree__menu button {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: none;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.chapter-tree__menu--up {
  top: auto;
  bottom: 100%;
}

.chapter-tree__menu button:disabled {
  color: #9ca3af;
  cursor: default;
}

.chapter-tree__menu button:disabled:hover {
  background: none;
}

.chapter-tree__shortcut {
  float: right;
  margin-left: 16px;
  color: #9ca3af;
  font-family: inherit;
  font-size: 12px;
}

.chapter-tree__menu button:hover {
  background: rgba(15, 23, 42, 0.06);
}

.chapter-tree__menu-separator {
  height: 1px;
  margin: 4px 0;
  background: #e5e7eb;
}

/* 菜单打开时的全屏透明遮罩：点击任意处关闭，不引入全局监听。 */
.chapter-tree__backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
}

.chapter-tree__empty {
  padding: 16px 4px;
}

.chapter-tree__empty-text {
  margin: 0 0 8px;
  color: #6b7280;
  font-size: 13px;
}

.chapter-tree__empty-action {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: none;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
}
</style>
