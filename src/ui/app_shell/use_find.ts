import { computed, nextTick, ref, type Ref } from 'vue'
import type { Node } from 'prosemirror-model'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { parseMarkdown } from '../editor/markdown.ts'
import { findMatches } from '../editor/find.ts'

/** 查找的范围：当前章节，或按阅读顺序的全文。 */
export type FindScope = 'chapter' | 'document'

/** 工作区需要的编辑器能力（ChapterEditor 的同名方法）。 */
export interface FindEditor {
  selectMatch(where: 'next' | 'previous' | 'first' | 'last'): boolean
  replaceSelectedMatch(replacement: string): boolean
  replaceAllIn(chapterId: ChapterId, text: string, query: string, replacement: string): number
  focus(): void
}

export interface FindOptions {
  /** 章节 id，按阅读顺序。 */
  readonly order: () => readonly ChapterId[]
  readonly contents: () => ReadonlyMap<ChapterId, string>
  /** 当前章节；查找到其他章节时切换过去。 */
  readonly selectedId: Ref<ChapterId | null>
  readonly editor: () => FindEditor | null
}

/**
 * 查找与替换（工作区一侧）：查找栏的状态、匹配数量与在章节之间前进 / 后退。
 *
 * - 本章：只在当前章节中查找，到末尾后回到开头。
 * - 全文：按阅读顺序查找全部章节，当前章节找完后进入下一个有匹配的章节（到最后一章后回到第一章）。
 * - 数量按各章节正文计算（与编辑器的解析相同）；当前是第几处由编辑器报告的选区决定。
 * - 替换与全部替换是普通的正文修改，进入各章节自己的撤销历史，由正常保存提交。
 */
export function useFind(options: FindOptions) {
  const open = ref(false)
  const query = ref('')
  const replacement = ref('')
  const scope = ref<FindScope>('chapter')
  const showReplace = ref(false)
  /** 当前章节中选区是第几个匹配（-1：不是匹配）。 */
  const selected = ref<{ readonly chapterId: ChapterId; readonly index: number } | null>(null)
  /** 最近一次全部替换的数量；修改查找词后清除。 */
  const replacedCount = ref<number | null>(null)

  /** 各章节解析后的文档，正文不变时复用。 */
  const parsed = new Map<ChapterId, { readonly text: string; readonly doc: Node }>()

  function matchCount(chapterId: ChapterId, text: string): number {
    let entry = parsed.get(chapterId)
    if (entry?.text !== text) {
      entry = { text, doc: parseMarkdown(text) }
      parsed.set(chapterId, entry)
    }
    return findMatches(entry.doc, query.value).length
  }

  /** 参与查找的章节（按阅读顺序）与各自的匹配数量。 */
  const counts = computed<ReadonlyArray<{ readonly id: ChapterId; readonly count: number }>>(() => {
    if (!open.value || query.value === '') return []
    const contents = options.contents()
    const current = options.selectedId.value
    const ids = scope.value === 'document' ? options.order() : current === null ? [] : [current]
    return ids.map((id) => ({ id, count: matchCount(id, contents.get(id) ?? '') }))
  })

  const total = computed(() => counts.value.reduce((sum, { count }) => sum + count, 0))

  /** 当前匹配在范围内的序号（从 1 开始）；选区不是匹配时为 null。 */
  const position = computed<number | null>(() => {
    const current = selected.value
    if (!current || current.index < 0 || current.chapterId !== options.selectedId.value) return null
    let before = 0
    for (const { id, count } of counts.value) {
      if (id === current.chapterId) return before + current.index + 1
      before += count
    }
    return null
  })

  function setSelected(chapterId: ChapterId, index: number): void {
    selected.value = { chapterId, index }
  }

  function show(withReplace: boolean, initial: string): void {
    if (initial !== '') query.value = initial
    if (withReplace) showReplace.value = true
    open.value = true
  }

  function close(): void {
    open.value = false
    replacedCount.value = null
  }

  function onQueryChange(): void {
    replacedCount.value = null
  }

  /**
   * 前进到下一个（后退到上一个）匹配：先在当前章节中找；全文范围内找不到时进入下一个有匹配的章节。
   * 返回是否选中了匹配。
   */
  async function step(direction: 'next' | 'previous'): Promise<boolean> {
    const editor = options.editor()
    if (!editor || query.value === '' || total.value === 0) return false
    if (editor.selectMatch(direction)) return true
    const list = counts.value
    const current = options.selectedId.value
    const start = list.findIndex(({ id }) => id === current)
    const forward = direction === 'next'
    // 依次查看后面（前面）的章节，最后回到当前章节本身（从开头 / 结尾再找一遍）。
    for (let offset = 1; offset <= list.length; offset++) {
      const index = (start + (forward ? offset : -offset) + list.length * 2) % list.length
      const { id, count } = list[index]
      if (count === 0) continue
      if (id !== current) {
        options.selectedId.value = id
        await nextTick()
      }
      return options.editor()?.selectMatch(forward ? 'first' : 'last') ?? false
    }
    return false
  }

  /** 替换当前匹配并前进到下一个；选区不是匹配时只前进。 */
  async function replace(): Promise<void> {
    const editor = options.editor()
    if (!editor) return
    editor.replaceSelectedMatch(replacement.value)
    await step('next')
  }

  /** 替换范围内的全部匹配，返回替换的数量。 */
  function replaceAll(): number {
    const editor = options.editor()
    if (!editor || query.value === '') return 0
    const contents = options.contents()
    let replaced = 0
    for (const { id, count } of counts.value) {
      if (count === 0) continue
      replaced += editor.replaceAllIn(id, contents.get(id) ?? '', query.value, replacement.value)
    }
    replacedCount.value = replaced
    return replaced
  }

  return {
    open,
    query,
    replacement,
    scope,
    showReplace,
    total,
    position,
    replacedCount,
    setSelected,
    show,
    close,
    onQueryChange,
    step,
    replace,
    replaceAll,
  }
}
