<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { MenuEntry } from '../../application/desktop_shell.ts'
import { formatShortcut } from './shortcuts.ts'

/**
 * 界面自己绘制的弹出菜单：没有系统菜单可用时（Storybook、测试，见 use_menu.ts）代替系统的右键菜单与按钮菜单。
 *
 * - 以 fixed 定位浮在界面之上，不被侧栏等滚动区域裁切；放不下时向上 / 向左翻转，始终留在窗口内。
 * - 键盘：↑ / ↓ 移动（循环、跳过不可用项），Home / End 到首 / 末，Enter / Space 执行，Esc / Tab 关闭。
 *   用键盘打开（keyboard 为 true）时第一项立即获得焦点。
 * - 点击菜单以外任意处关闭（透明遮罩，不引入全局监听）。
 * - 关闭时焦点回到打开前的位置；执行的操作若要把焦点移到别处（重命名输入框、对话框），由调用方在之后移动。
 * - 只发出 select / close，不执行任何操作。标准编辑动作（role）发出 `role:cut` 这样的 id；
 *   网页无法主动读取剪贴板，粘贴只出现在系统菜单中。子菜单在这里展开为一组带标题的项。
 */
export type { MenuEntry }

export type MenuAnchor =
  | { readonly x: number; readonly y: number }
  | { readonly rect: { top: number; bottom: number; left: number; right: number }; readonly align?: 'start' | 'end' }

const props = defineProps<{
  items: readonly MenuEntry[]
  anchor: MenuAnchor
  /** 菜单的无障碍名称。 */
  label?: string
  /** 由键盘打开：第一项立即获得焦点。 */
  keyboard?: boolean
  menuClass?: string
  backdropClass?: string
}>()

const emit = defineEmits<{
  select: [id: string]
  close: []
}>()

/** 与窗口边缘保持的最小距离。 */
const EDGE = 8
/** 菜单与锚点按钮之间的间距。 */
const GAP = 4

const menu = ref<HTMLElement | null>(null)
const position = ref<{ left: number; top: number } | null>(null)
let previousFocus: HTMLElement | null = null

type Row =
  | { readonly kind: 'item'; readonly id: string; readonly label: string; readonly shortcut?: string; readonly disabled: boolean; readonly checked?: boolean; readonly nested: boolean }
  | { readonly kind: 'separator' }
  | { readonly kind: 'heading'; readonly label: string }

const ROLE_LABELS = { cut: '剪切', copy: '拷贝', 'select-all': '全选' } as const
const ROLE_SHORTCUTS = { cut: 'CmdOrCtrl+X', copy: 'CmdOrCtrl+C', 'select-all': 'CmdOrCtrl+A' } as const

function toRows(entries: readonly MenuEntry[], nested: boolean): Row[] {
  const rows: Row[] = []
  for (const entry of entries) {
    if ('separator' in entry) rows.push({ kind: 'separator' })
    else if ('role' in entry) {
      // 网页无法主动读取剪贴板；关闭窗口只出现在菜单栏。
      if (entry.role === 'paste' || entry.role === 'close-window') continue
      rows.push({ kind: 'item', id: `role:${entry.role}`, label: ROLE_LABELS[entry.role], shortcut: formatShortcut(ROLE_SHORTCUTS[entry.role]), disabled: false, nested })
    } else if (entry.submenu) {
      rows.push({ kind: 'heading', label: entry.label }, ...toRows(entry.submenu, true))
    } else {
      rows.push({
        kind: 'item',
        id: entry.id,
        label: entry.label,
        shortcut: entry.shortcut ? formatShortcut(entry.shortcut) : undefined,
        disabled: !!entry.disabled,
        checked: entry.checked,
        nested,
      })
    }
  }
  // 去掉首尾与连续的分隔线（例如只剩粘贴的一组）。
  return rows.filter((row, index, all) => row.kind !== 'separator' || (index > 0 && index < all.length - 1 && all[index + 1].kind !== 'separator'))
}

const rows = computed(() => toRows(props.items, false))
const hasChecks = computed(() => rows.value.some((row) => row.kind === 'item' && row.checked !== undefined))

function place(): void {
  const element = menu.value
  if (!element) return
  const width = element.offsetWidth
  const height = element.offsetHeight
  const maxLeft = window.innerWidth - width - EDGE
  const maxTop = window.innerHeight - height - EDGE
  let left: number
  let top: number
  if ('rect' in props.anchor) {
    const { rect, align = 'start' } = props.anchor
    left = align === 'end' ? rect.right - width : rect.left
    top = rect.bottom + GAP
    if (top > maxTop && rect.top - GAP - height >= EDGE) top = rect.top - GAP - height
  } else {
    left = props.anchor.x
    top = props.anchor.y
    if (left > maxLeft) left = props.anchor.x - width
    if (top > maxTop) top = props.anchor.y - height
  }
  position.value = {
    left: Math.max(EDGE, Math.min(left, maxLeft)),
    top: Math.max(EDGE, Math.min(top, maxTop)),
  }
}

function buttons(): HTMLButtonElement[] {
  return [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
}

function focusAt(index: number): void {
  const list = buttons()
  if (list.length === 0) return
  list[(index + list.length) % list.length].focus()
}

onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  place()
  await nextTick()
  if (props.keyboard) focusAt(0)
  else menu.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  // 焦点仍在菜单里（或已经掉到页面上）时放回原处。
  const active = document.activeElement
  const lost = active === null || active === document.body || (menu.value?.contains(active) ?? false)
  if (lost && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})

function onKeydown(event: KeyboardEvent): void {
  const list = buttons()
  const current = list.indexOf(document.activeElement as HTMLButtonElement)
  switch (event.key) {
    case 'ArrowDown':
      focusAt(current + 1)
      break
    case 'ArrowUp':
      focusAt(current === -1 ? -1 : current - 1)
      break
    case 'Home':
      focusAt(0)
      break
    case 'End':
      focusAt(-1)
      break
    case 'Escape':
    case 'Tab':
      emit('close')
      break
    default:
      return
  }
  event.preventDefault()
  event.stopPropagation()
}

function onPointerEnter(event: PointerEvent): void {
  const target = event.currentTarget as HTMLButtonElement
  if (!target.disabled) target.focus({ preventScroll: true })
}
</script>

<template>
  <div
    class="popup-menu__backdrop"
    :class="backdropClass"
    @click="emit('close')"
    @contextmenu.prevent="emit('close')"
  ></div>
  <ul
    ref="menu"
    class="popup-menu"
    :class="menuClass"
    role="menu"
    tabindex="-1"
    :aria-label="label"
    :style="position ? { left: `${position.left}px`, top: `${position.top}px` } : { visibility: 'hidden' }"
    @keydown="onKeydown"
    @click.stop
    @contextmenu.prevent
  >
    <template v-for="(row, index) in rows" :key="row.kind === 'item' ? row.id : `${row.kind}-${index}`">
      <li v-if="row.kind === 'separator'" class="popup-menu__separator" role="separator"></li>
      <li v-else-if="row.kind === 'heading'" class="popup-menu__heading" role="presentation">{{ row.label }}</li>
      <li v-else role="none">
        <button
          type="button"
          class="popup-menu__item"
          :class="{ 'popup-menu__item--nested': row.nested, 'popup-menu__item--checkable': hasChecks }"
          :role="row.checked === undefined ? 'menuitem' : 'menuitemcheckbox'"
          :aria-checked="row.checked"
          tabindex="-1"
          :disabled="row.disabled"
          @pointerenter="onPointerEnter"
          @click="emit('select', row.id)"
        >
          <span v-if="row.checked" class="popup-menu__check" aria-hidden="true">✓</span>
          <span class="popup-menu__label">{{ row.label }}</span>
          <kbd v-if="row.shortcut" class="popup-menu__shortcut">{{ row.shortcut }}</kbd>
        </button>
      </li>
    </template>
  </ul>
</template>

<style scoped>
.popup-menu__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.popup-menu {
  position: fixed;
  z-index: calc(var(--z-popover) + 1);
  min-width: 176px;
  max-width: 320px;
  margin: 0;
  padding: var(--space-2);
  list-style: none;
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-popover);
  color: var(--color-text);
  font-size: var(--text-m);
  line-height: var(--leading-normal);
  outline: none;
  animation: popup-menu-in var(--duration-fast) var(--ease-out);
}

@keyframes popup-menu-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
}

.popup-menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  height: var(--control-h-m);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: default;
}

/* 指针经过与键盘移动都把焦点放在菜单项上：同一种高亮。 */
.popup-menu__item:focus {
  outline: none;
  background: var(--color-accent);
  color: var(--color-text-on-accent);
}

.popup-menu__item--checkable {
  position: relative;
  padding-left: var(--space-7);
}

.popup-menu__item--nested {
  padding-left: var(--space-7);
}

.popup-menu__check {
  position: absolute;
  left: var(--space-3);
  font-size: var(--text-s);
}

.popup-menu__heading {
  padding: var(--space-2) var(--space-4) 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-s);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
}

.popup-menu__item:disabled {
  color: var(--color-text-disabled);
}

.popup-menu__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.popup-menu__shortcut {
  flex: none;
  color: var(--color-text-tertiary);
  font-family: inherit;
  font-size: var(--text-s);
  letter-spacing: 0.04em;
}

.popup-menu__item:focus .popup-menu__shortcut {
  color: inherit;
  opacity: 0.8;
}

.popup-menu__item:disabled .popup-menu__shortcut {
  color: var(--color-text-disabled);
}

.popup-menu__separator {
  height: 1px;
  margin: var(--space-2) var(--space-4);
  background: var(--color-separator);
}
</style>
