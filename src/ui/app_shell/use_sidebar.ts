import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { DesktopShell } from '../../application/desktop_shell.ts'

/**
 * 侧栏宽度（ui-spec §31）：默认 260px，拖动分隔线在 180–480px 之间调整，双击恢复默认；
 * 同时保证正文区至少留出 MIN_MAIN 宽度。拖到比最窄处再窄一截松手时隐藏侧栏（macOS 侧栏的习惯）。
 * 宽度与是否显示是本机的界面偏好（应用级状态，见 DesktopShell），不随项目保存。
 */
export const SIDEBAR_DEFAULT = 260
export const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480
const SIDEBAR_COLLAPSE = SIDEBAR_MIN - 60
const MIN_MAIN = 440
const WIDTH_KEY = 'sidebar-width'
const VISIBLE_KEY = 'sidebar-visible'
const RESIZE_STEP = 16

export interface Sidebar {
  /** 侧栏元素（模板 ref）：隐藏侧栏时据此判断焦点是否在侧栏中。 */
  readonly element: Ref<HTMLElement | null>
  readonly visible: Readonly<Ref<boolean>>
  readonly width: Readonly<Ref<number>>
  readonly maxWidth: Readonly<Ref<number>>
  /** 正在拖动分隔线。 */
  readonly resizing: Readonly<Ref<boolean>>
  setWidth(width: number): void
  /** 显示 / 隐藏侧栏。隐藏时焦点若在侧栏中，调用 onHideWithFocus，不让焦点落到看不见的地方。 */
  setVisible(visible: boolean): Promise<void>
  /** 分隔线的 pointerdown。 */
  startResize(event: PointerEvent): void
  /** 分隔线的 keydown：←→ 调整，Home / End 到最窄 / 最宽。 */
  onResizeKey(event: KeyboardEvent): void
}

export function useSidebar(
  shell: Pick<DesktopShell, 'getPreference' | 'setPreference'>,
  onHideWithFocus: () => void,
): Sidebar {
  const element = ref<HTMLElement | null>(null)
  const storedWidth = Number(shell.getPreference(WIDTH_KEY))
  const preferred = ref(Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : SIDEBAR_DEFAULT)
  const visible = ref(shell.getPreference(VISIBLE_KEY) !== 'false')
  const windowWidth = ref(window.innerWidth)
  const maxWidth = computed(() => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, windowWidth.value - MIN_MAIN)))
  const width = computed(() => Math.round(Math.min(Math.max(preferred.value, SIDEBAR_MIN), maxWidth.value)))
  const resizing = ref(false)

  function onWindowResize(): void {
    windowWidth.value = window.innerWidth
  }

  onMounted(() => window.addEventListener('resize', onWindowResize))
  onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize))

  function setWidth(next: number): void {
    preferred.value = Math.min(Math.max(next, SIDEBAR_MIN), maxWidth.value)
    shell.setPreference(WIDTH_KEY, String(Math.round(preferred.value)))
  }

  async function setVisible(next: boolean): Promise<void> {
    const focusInSidebar = element.value?.contains(document.activeElement) ?? false
    visible.value = next
    shell.setPreference(VISIBLE_KEY, String(next))
    await nextTick()
    if (!next && focusInSidebar) onHideWithFocus()
  }

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    const startX = event.clientX
    const startWidth = width.value
    let requested = startWidth
    resizing.value = true
    handle.setPointerCapture?.(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      requested = startWidth + moveEvent.clientX - startX
      setWidth(requested)
    }
    const end = () => {
      resizing.value = false
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      if (requested < SIDEBAR_COLLAPSE) void setVisible(false)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  function onResizeKey(event: KeyboardEvent): void {
    const next: Record<string, number> = {
      ArrowLeft: width.value - RESIZE_STEP,
      ArrowRight: width.value + RESIZE_STEP,
      Home: SIDEBAR_MIN,
      End: maxWidth.value,
    }
    if (!(event.key in next)) return
    event.preventDefault()
    setWidth(next[event.key])
  }

  return { element, visible, width, maxWidth, resizing, setWidth, setVisible, startResize, onResizeKey }
}
