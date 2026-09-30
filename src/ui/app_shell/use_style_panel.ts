import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'

export interface StylePanel {
  readonly open: Readonly<Ref<boolean>>
  /** "样式"按钮与面板（模板 ref）。 */
  readonly button: Ref<HTMLButtonElement | null>
  readonly panel: Ref<HTMLElement | null>
  show(): Promise<void>
  toggle(): void
  /** 关闭面板。用键盘关闭（传入事件）时焦点回到打开前的位置，没有时回到"样式"按钮。 */
  close(event?: KeyboardEvent): void
}

/**
 * 文档样式面板的打开 / 关闭与焦点。
 *
 * 点击面板以外的地方关闭面板（"样式"按钮自己切换）。不用覆盖整个窗口的透明遮罩：
 * 面板打开时正文仍可以滚动，一边看效果一边调整；点击也照常作用于点到的地方（如在正文中放置光标）。
 */
export function useStylePanel(options: {
  /** 网页中没有获得焦点的元素时（从系统菜单栏打开），关闭后焦点回到的位置。 */
  readonly lastFocused: () => HTMLElement | null
  /** 焦点回到正文：经编辑器聚焦，光标与滚动位置保持原样。 */
  readonly focusEditor: () => void
}): StylePanel {
  const open = ref(false)
  const button = ref<HTMLButtonElement | null>(null)
  const panel = ref<HTMLElement | null>(null)
  /** 打开面板前的焦点：关闭后回到那里（从菜单栏打开时通常是正文）。 */
  let focusBefore: HTMLElement | null = null

  async function show(): Promise<void> {
    if (open.value) return
    const active = document.activeElement
    focusBefore = active instanceof HTMLElement && active !== document.body ? active : options.lastFocused()
    open.value = true
    await nextTick()
    panel.value?.focus({ preventScroll: true })
  }

  function close(event?: KeyboardEvent): void {
    event?.preventDefault()
    open.value = false
    if (!event) return
    const target = focusBefore?.isConnected ? focusBefore : button.value
    if (target?.closest('.chapter-editor__content')) options.focusEditor()
    else target?.focus({ preventScroll: true })
  }

  function toggle(): void {
    if (open.value) close()
    else void show()
  }

  function closeOnOutsidePointer(event: PointerEvent): void {
    const target = event.target instanceof Node ? event.target : null
    if (target && (panel.value?.contains(target) || button.value?.contains(target))) return
    close()
  }

  watch(open, (isOpen) => {
    if (isOpen) document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    else document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
  })
  onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutsidePointer, true))

  return { open, button, panel, show, toggle, close }
}
