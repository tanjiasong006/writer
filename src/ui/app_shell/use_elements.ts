import { computed } from 'vue'
import type { Node } from 'prosemirror-model'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { parseMarkdown } from '../editor/markdown.ts'
import { elementsOf, indexElements, type ChapterElement, type ElementIndex } from '../editor/element_numbering.ts'

/**
 * 全文的图表编号（docs/decisions.md 第 12 节）：按阅读顺序、一级章节分组。
 * 各章节按正文解析，正文不变时复用；不含图片与表格标题记号的章节不解析。
 * signature 只在编号或引用目标变化时改变：输入文字时不必让所有引用重新显示。
 */
export function useElementIndex(options: {
  readonly chapters: () => ReadonlyArray<{ readonly id: ChapterId; readonly top: number | null }>
  readonly contents: () => ReadonlyMap<ChapterId, string>
}) {
  const cache = new Map<ChapterId, { readonly text: string; readonly elements: readonly ChapterElement[] }>()

  function elements(id: ChapterId, text: string): readonly ChapterElement[] {
    const cached = cache.get(id)
    if (cached?.text === text) return cached.elements
    const found = text.includes('![') || text.includes('Table: ') ? elementsOf(parseMarkdown(text) as Node) : []
    cache.set(id, { text, elements: found })
    return found
  }

  const index = computed<ElementIndex>(() => {
    const contents = options.contents()
    return indexElements(options.chapters(), (id) => elements(id, contents.get(id) ?? ''))
  })

  /** 编号、标识、图注与所在章节都相同时 signature 不变。 */
  const signature = computed(() =>
    JSON.stringify(index.value.entries.map((entry) => [entry.kind, entry.id, entry.label, entry.caption, entry.chapterId])),
  )

  return { index, signature }
}
