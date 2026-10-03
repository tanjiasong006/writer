import { computed } from 'vue'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { citationNumbers, type ReferenceEntry } from '../../domain/bibliography/bibliography.ts'

/** 正文中的文献引用地址（链接的地址部分）。 */
const CITATION = /\]\((writer:cite\/[A-Za-z0-9_-]+)\)/g

/**
 * 文献引用的编号（docs/decisions.md 第 13 节）：按阅读顺序扫描各章节正文中的引用地址，
 * 按第一次出现的顺序给存在的条目编号（与 Rust `render::citations` 相同）。
 * signature 只在编号变化时改变：输入文字时引用的显示不必更新。
 */
export function useCitations(options: {
  readonly order: () => readonly ChapterId[]
  readonly contents: () => ReadonlyMap<ChapterId, string>
  readonly references: () => readonly ReferenceEntry[]
}) {
  /** 各章节中的引用地址，按阅读顺序。 */
  const byChapter = computed(() => {
    const contents = options.contents()
    return options.order().map((id) => {
      const text = contents.get(id) ?? ''
      return { id, hrefs: text.includes('writer:cite/') ? [...text.matchAll(CITATION)].map((match) => match[1]) : [] }
    })
  })
  const hrefs = computed(() => byChapter.value.flatMap((chapter) => chapter.hrefs))

  const numbers = computed(() => citationNumbers(hrefs.value, options.references()))
  const signature = computed(() => JSON.stringify([...numbers.value]))

  /** 条目在正文中被引用的次数。 */
  function count(id: string): number {
    return hrefs.value.filter((href) => href === `writer:cite/${id}`).length
  }

  /**
   * 在 chapterId 中第 index 个引用的位置插入对 id 的引用后它的编号（插入时写入的链接文字）。
   * 在已有引用之前插入新文献时，它取得较小的编号，后面的编号随之后移。
   */
  function numberIfInserted(chapterId: ChapterId, index: number, id: string): number {
    const sequence: string[] = []
    for (const chapter of byChapter.value) {
      if (chapter.id !== chapterId) sequence.push(...chapter.hrefs)
      else sequence.push(...chapter.hrefs.slice(0, index), `writer:cite/${id}`, ...chapter.hrefs.slice(index))
    }
    return citationNumbers(sequence, options.references()).get(id) ?? 0
  }

  return { numbers, signature, count, numberIfInserted }
}
