import type { Node } from 'prosemirror-model'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { parseChapterRefAddress } from '../../domain/chapter_reference/chapter_reference.ts'
import { parseChapter, serializeChapter } from './markdown.ts'
import { nodes } from './schema.ts'
import type { ChapterRefLabel } from './chapter_ref_view.ts'

/**
 * 整篇文档范围的章节引用检查（docs/decisions.md 第 9 节）：更新链接文字（缓存）、找出失效引用、统计指向某些章节的引用。
 * 按编辑器的 Markdown 解析识别引用（代码中的文字不算），只解析含有引用地址的正文。
 */

/** 一处失效引用：所在章节、它是该章节中的第几个引用（从 0 开始）、链接文字与它在段落中前后的文字。 */
export interface BrokenChapterRef {
  readonly chapterId: ChapterId
  readonly index: number
  readonly text: string
  readonly before: string
  readonly after: string
}

export interface ChapterRefUpdate {
  /** 需要写回的章节正文（只包含链接文字过期的章节）。 */
  readonly texts: ReadonlyMap<ChapterId, string>
  /** 更新的引用数量。 */
  readonly updated: number
  /** 失效引用，按阅读顺序。 */
  readonly broken: readonly BrokenChapterRef[]
}

/** 上下文中引用前后各保留的字数。 */
const CONTEXT_CHARS = 16

/**
 * 检查全部章节（chapters 为阅读顺序）：链接文字与当前生成的文字不同的章节按当前文字整体重新写出
 * （渲染结果不变，其他 Markdown 写法也可能被规范化，已接受）；失效引用只报告，不改动。
 */
export function updateChapterRefs(
  chapters: readonly ChapterId[],
  contents: ReadonlyMap<ChapterId, string>,
  label: ChapterRefLabel,
): ChapterRefUpdate {
  const texts = new Map<ChapterId, string>()
  const broken: BrokenChapterRef[] = []
  let updated = 0
  for (const chapterId of chapters) {
    const text = contents.get(chapterId) ?? ''
    if (!text.includes('writer:')) continue
    const { doc, format } = parseChapter(text)
    let stale = 0
    eachRef(doc, (ref, index, parent, childIndex) => {
      const resolved = label(ref.attrs.href as string)
      if (resolved !== null) {
        if (resolved.text !== ref.attrs.cached) stale++
        return
      }
      broken.push({ chapterId, index, text: ref.attrs.cached as string, ...context(parent, childIndex, label) })
    })
    if (stale === 0) continue
    updated += stale
    texts.set(chapterId, serializeChapter(doc, format, label))
  }
  return { texts, updated, broken }
}

/** from 以外的章节中，指向 targets 中任一章节的引用数量。 */
export function countRefsTo(
  contents: ReadonlyMap<ChapterId, string>,
  targets: ReadonlySet<ChapterId>,
  from: (chapterId: ChapterId) => boolean = () => true,
): number {
  let count = 0
  for (const [chapterId, text] of contents) {
    if (!from(chapterId) || !text.includes('writer:')) continue
    eachRef(parseChapter(text).doc, (ref) => {
      const address = parseChapterRefAddress(ref.attrs.href as string)
      if (address.kind === 'ref' && targets.has(address.id)) count++
    })
  }
  return count
}

function eachRef(doc: Node, visit: (ref: Node, index: number, parent: Node, childIndex: number) => void): void {
  let index = 0
  doc.descendants((node, _pos, parent, childIndex) => {
    if (node.type !== nodes.chapter_ref || !parent) return true
    visit(node, index++, parent, childIndex)
    return false
  })
}

/** 引用所在段落中它前后的文字（其他引用按显示的文字），过长时省略两端。 */
function context(parent: Node, childIndex: number, label: ChapterRefLabel): { before: string; after: string } {
  const shown = (node: Node) =>
    node.type === nodes.chapter_ref ? (label(node.attrs.href as string)?.text ?? (node.attrs.cached as string)) : node.textContent
  let text = ''
  let offset = 0
  let end = 0
  parent.forEach((child, _, i) => {
    if (i === childIndex) offset = text.length
    text += shown(child)
    if (i === childIndex) end = text.length
  })
  const start = Math.max(0, offset - CONTEXT_CHARS)
  const stop = Math.min(text.length, end + CONTEXT_CHARS)
  return {
    before: `${start > 0 ? '…' : ''}${text.slice(start, offset)}`,
    after: `${text.slice(end, stop)}${stop < text.length ? '…' : ''}`,
  }
}
