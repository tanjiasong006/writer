import { computed } from 'vue'
import type { Node } from 'prosemirror-model'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { NO_TEXT, addCounts, type TextCount } from '../../domain/word_count/word_count.ts'
import { parseMarkdown } from '../editor/markdown.ts'
import { countDoc } from '../editor/text_stats.ts'
import type { ChapterRefLabel } from '../editor/chapter_ref_view.ts'
import type { EditorStats } from '../editor/ChapterEditor.vue'

/**
 * 全文字数：各章节正文字数之和（与编辑器相同的规则，章节标题不计）。
 * 当前章节使用编辑器报告的字数；其他章节按正文解析计算，正文不变时复用。
 * 只在读取时计算（computed 是惰性的），不打开字数统计时不为全文解析。
 */
export function useDocumentCount(options: {
  readonly contents: () => ReadonlyMap<ChapterId, string>
  readonly refLabel: () => ChapterRefLabel
  readonly live: () => EditorStats | null
}) {
  const cache = new Map<ChapterId, { readonly text: string; readonly label: ChapterRefLabel; readonly count: TextCount }>()

  function chapterCount(id: ChapterId, text: string, label: ChapterRefLabel): TextCount {
    const cached = cache.get(id)
    if (cached?.text === text && cached.label === label) return cached.count
    const doc: Node = parseMarkdown(text)
    const count = countDoc(doc, label)
    cache.set(id, { text, label, count })
    return count
  }

  return computed<TextCount>(() => {
    const live = options.live()
    const label = options.refLabel()
    let total = NO_TEXT
    for (const [id, text] of options.contents()) {
      total = addCounts(total, live?.chapterId === id ? live.chapter : chapterCount(id, text, label))
    }
    return total
  })
}
