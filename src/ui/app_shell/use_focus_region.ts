import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { FocusRegion } from './app_menu.ts'

export interface FocusTracking {
  /** 键盘焦点所在的区域：菜单栏按它决定哪些命令可用（app_menu.ts）。 */
  readonly region: Readonly<Ref<FocusRegion>>
  /** 最近一次获得焦点的元素（弹出面板以外）：从菜单栏打开的面板关闭后，焦点回到这里。 */
  lastFocused(): HTMLElement | null
}

function regionOf(element: Element | null): FocusRegion {
  if (!(element instanceof HTMLElement)) return 'other'
  if (element.closest('.chapter-editor__content')) return 'editor'
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return 'text-input'
  if (element.closest('.chapter-tree__list')) return 'tree'
  return 'other'
}

/**
 * 跟踪键盘焦点。focusin / focusout 覆盖所有焦点移动；焦点离开到页面之外时为 other。
 * popover() 返回的弹出面板中的焦点不记入 lastFocused。
 */
export function useFocusRegion(popover: () => HTMLElement | null): FocusTracking {
  const region = ref<FocusRegion>('other')
  let last: HTMLElement | null = null

  function onFocusChange(event: FocusEvent): void {
    const target = event.type === 'focusin' ? event.target : event.relatedTarget
    region.value = regionOf(target instanceof Element ? target : null)
    if (event.type === 'focusin' && target instanceof HTMLElement && !popover()?.contains(target)) {
      last = target
    }
  }

  onMounted(() => {
    document.addEventListener('focusin', onFocusChange)
    document.addEventListener('focusout', onFocusChange)
    region.value = regionOf(document.activeElement)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('focusin', onFocusChange)
    document.removeEventListener('focusout', onFocusChange)
  })

  return { region, lastFocused: () => last }
}
