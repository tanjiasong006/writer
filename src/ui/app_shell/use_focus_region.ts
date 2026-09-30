import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { FocusRegion } from './app_menu.ts'

function regionOf(element: Element | null): FocusRegion {
  if (!(element instanceof HTMLElement)) return 'other'
  if (element.closest('.chapter-editor__content')) return 'editor'
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return 'text-input'
  if (element.closest('.chapter-tree__list')) return 'tree'
  return 'other'
}

/**
 * 跟踪键盘焦点所在的区域：菜单栏按它决定哪些命令可用（app_menu.ts）。
 * focusin / focusout 覆盖所有焦点移动；焦点离开到页面之外时为 other。
 */
export function useFocusRegion(): Readonly<Ref<FocusRegion>> {
  const region = ref<FocusRegion>('other')

  function onFocusChange(event: FocusEvent): void {
    const target = event.type === 'focusin' ? event.target : event.relatedTarget
    region.value = regionOf(target instanceof Element ? target : null)
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

  return region
}
