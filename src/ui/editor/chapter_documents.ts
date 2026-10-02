import type { Node } from 'prosemirror-model'
import type { EditorState } from 'prosemirror-state'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { parseChapter, serializeChapter, type TextFormat } from './markdown.ts'
import { createEditorState } from './plugins.ts'
import type { ChapterRefLabel } from './chapter_ref_view.ts'

/**
 * 应用状态（章节正文 Markdown）与编辑器状态（每个章节一个 EditorState）之间的适配。
 *
 * - 每个章节缓存自己的 EditorState：切换章节后撤销历史、选区仍在。
 * - 正文只在文档真正改变时重新生成；只移动光标、改变选区不产生新正文。
 * - 编辑后又回到载入时的文档（例如全部撤销），给出载入时的原文而不是重新序列化的结果：
 *   没有真正修改的章节不会被规范化（docs/decisions.md 第 2 节）。
 * - 章节引用的链接文字（缓存）按写出时的 refLabel 生成；章节树变化本身不产生新正文（docs/decisions.md 第 9 节）。
 */
interface Entry {
  readonly state: EditorState
  /** 与 state.doc 对应的正文。 */
  readonly text: string
  /** 载入时的文档与原文。 */
  readonly baseline: { readonly doc: Node; readonly text: string; readonly format: TextFormat }
}

export class ChapterDocuments {
  private readonly entries = new Map<ChapterId, Entry>()

  /** 写出正文时章节引用的文字。 */
  refLabel: ChapterRefLabel | null = null

  /**
   * 章节的编辑器状态。缓存的状态与正文一致时沿用（保留撤销历史），
   * 否则（首次打开、正文被外部修改）按正文重新创建。
   */
  stateFor(chapterId: ChapterId, text: string): EditorState {
    const cached = this.entries.get(chapterId)
    if (cached && cached.text === text) return cached.state
    const entry = load(text)
    this.entries.set(chapterId, entry)
    return entry.state
  }

  /** 该章节的缓存是否就是这份正文（外部修改过的章节不是）。 */
  isCurrent(chapterId: ChapterId, text: string): boolean {
    return this.entries.get(chapterId)?.text === text
  }

  /**
   * 记录章节的新状态。返回新的正文；文档没有改变（只是选区变化）或正文不变时返回 null。
   * 前置条件：该章节已通过 stateFor 打开。
   */
  update(chapterId: ChapterId, state: EditorState): string | null {
    const entry = this.entries.get(chapterId)
    if (!entry) throw new Error(`chapter ${chapterId} is not open in the editor`)
    if (state.doc === entry.state.doc) {
      this.entries.set(chapterId, { ...entry, state })
      return null
    }
    const { baseline } = entry
    const text = state.doc.eq(baseline.doc) ? baseline.text : serializeChapter(state.doc, baseline.format, this.refLabel)
    this.entries.set(chapterId, { ...entry, state, text })
    return text === entry.text ? null : text
  }

  /**
   * 当前章节的正文被外部修改：返回应替换成的文档，并以新正文为基准。
   * 之后由调用方用一个事务替换文档（保留在撤销历史中），再调用 update 记录。
   */
  rebase(chapterId: ChapterId, text: string): Node {
    const entry = this.entries.get(chapterId)
    if (!entry) throw new Error(`chapter ${chapterId} is not open in the editor`)
    const { doc, format } = parseChapter(text)
    this.entries.set(chapterId, { ...entry, text, baseline: { doc, text, format } })
    return doc
  }
}

function load(text: string): Entry {
  const { doc, format } = parseChapter(text)
  return { state: createEditorState(doc), text, baseline: { doc, text, format } }
}
