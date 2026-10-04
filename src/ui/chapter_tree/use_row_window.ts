import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * 章节很多时只渲染滚动区域附近的行（虚拟滚动，ui-spec §35）。
 *
 * 行高固定（--tree-row-h），每行按序号绝对定位，列表保持全部行的高度，滚动条与直接渲染全部行时相同。
 * 选中、键盘焦点、重命名、拖拽中与菜单作用的行即使不在附近也保留在 DOM 中（pinned），
 * 焦点、输入框与拖拽源不会因为滚动而消失。行数少于 MIN_ROWS 或量不到滚动区域高度时渲染全部行。
 */

export const MIN_ROWS = 300
/** 可见区域上下各多渲染的行数：快速滚动时不露出空白。 */
export const OVERSCAN = 20
const FALLBACK_ROW_HEIGHT = 32

/** 可见区域（加上下余量）覆盖的行序号范围 [start, end)。 */
export function rowWindow(
  count: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = OVERSCAN,
): { readonly start: number; readonly end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  return { start, end: Math.max(start, end) }
}

export interface RowWindow<T> {
  /** 是否在按窗口渲染（否则渲染全部行，按正常文档流排列）。 */
  readonly virtual: Ref<boolean>
  /** 要渲染的行与它们在全部行中的序号，按序号排列。 */
  readonly rendered: Ref<readonly { readonly row: T; readonly index: number }[]>
  readonly rowHeight: Ref<number>
}

export function useRowWindow<T extends { readonly id: string }>(options: {
  readonly rows: () => readonly T[]
  readonly scroller: Ref<HTMLElement | null>
  readonly pinned: () => readonly (string | null | undefined)[]
}): RowWindow<T> {
  const scrollTop = ref(0)
  const viewportHeight = ref(0)
  const rowHeight = ref(FALLBACK_ROW_HEIGHT)

  function measure(): void {
    const element = options.scroller.value
    if (!element) return
    scrollTop.value = element.scrollTop
    viewportHeight.value = element.clientHeight
    const token = parseFloat(getComputedStyle(element).getPropertyValue('--tree-row-h'))
    if (token > 0) rowHeight.value = token
  }

  let observer: ResizeObserver | null = null
  onMounted(() => {
    measure()
    options.scroller.value?.addEventListener('scroll', measure, { passive: true })
    if (typeof ResizeObserver !== 'undefined' && options.scroller.value) {
      observer = new ResizeObserver(measure)
      observer.observe(options.scroller.value)
    }
  })
  onBeforeUnmount(() => {
    options.scroller.value?.removeEventListener('scroll', measure)
    observer?.disconnect()
  })

  const virtual = computed(() => options.rows().length >= MIN_ROWS && viewportHeight.value > 0)

  const rendered = computed(() => {
    const rows = options.rows()
    if (!virtual.value) return rows.map((row, index) => ({ row, index }))
    const { start, end } = rowWindow(rows.length, rowHeight.value, scrollTop.value, viewportHeight.value)
    const indices = new Set<number>()
    for (let index = start; index < end; index++) indices.add(index)
    const pinned = new Set(options.pinned().filter((id): id is string => typeof id === 'string'))
    if (pinned.size > 0) rows.forEach((row, index) => pinned.has(row.id) && indices.add(index))
    return [...indices].sort((a, b) => a - b).map((index) => ({ row: rows[index]!, index }))
  })

  return { virtual, rendered, rowHeight }
}
