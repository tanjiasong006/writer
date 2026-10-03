import type { Node } from 'prosemirror-model'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { elementLabel, type ElementKind } from '../../domain/chapter_reference/chapter_reference.ts'
import { nodes } from './schema.ts'

/**
 * 图表的编号（docs/decisions.md 第 12 节，与 Rust `render::elements` 相同的规则）：
 * 有图注的独立图片是“图”，有标题的表格是“表”，按一级章节分组、按阅读顺序编号（“图 2-1”）。
 * 没有图注 / 标题的不编号，也不能被引用。
 */

/** 一个章节中有编号的图表（按文档顺序）。 */
export interface ChapterElement {
  readonly kind: ElementKind
  /** 被引用时的标识（图片 title 的 `fig:` 之后、表格的 captionId）；还没有被引用过时为 null。 */
  readonly id: string | null
  readonly caption: string
  /** 在文档中的位置。 */
  readonly pos: number
}

/** 图片 title 中的标识。 */
export function figureId(title: string | null): string | null {
  return /^fig:([A-Za-z0-9_-]+)$/.exec(title ?? '')?.[1] ?? null
}

export function elementsOf(doc: Node): ChapterElement[] {
  const found: ChapterElement[] = []
  doc.descendants((node, pos) => {
    if (node.type === nodes.figure) {
      const caption = (node.attrs.alt as string).trim()
      if (caption !== '') found.push({ kind: 'figure', id: figureId(node.attrs.title as string | null), caption, pos })
      return false
    }
    if (node.type === nodes.table) {
      const caption = ((node.attrs.caption as string | null) ?? '').trim()
      if (caption !== '') found.push({ kind: 'table', id: node.attrs.captionId as string | null, caption, pos })
      return false
    }
    return true
  })
  return found
}

/** 章节中第一个图 / 表的编号从哪里开始：一级章节号与之前已有的图、表数量。 */
export interface ElementStart {
  /** 所在一级章节的编号；没有时为 null（编号只有序号）。 */
  readonly chapter: number | null
  readonly figures: number
  readonly tables: number
}

export const NO_ELEMENT_START: ElementStart = { chapter: null, figures: 0, tables: 0 }

/** 全文中一个有编号的图表。 */
export interface ElementEntry extends ChapterElement {
  readonly chapterId: ChapterId
  /** 在所在章节的同类图表中的序号（从 0 开始）。 */
  readonly index: number
  /** “图 2-1”。 */
  readonly label: string
}

export interface ElementIndex {
  readonly entries: readonly ElementEntry[]
  start(chapterId: ChapterId): ElementStart
  /** 引用目标；没有（或没有编号）时为 null。 */
  find(kind: ElementKind, id: string): ElementEntry | null
}

/**
 * 按阅读顺序编号全文的图表。chapters 是章节 id 与所在一级章节的编号（按阅读顺序），
 * elements 给出各章节中有编号的图表。
 */
export function indexElements(
  chapters: ReadonlyArray<{ readonly id: ChapterId; readonly top: number | null }>,
  elements: (chapterId: ChapterId) => readonly ChapterElement[],
): ElementIndex {
  const entries: ElementEntry[] = []
  const starts = new Map<ChapterId, ElementStart>()
  const byId = new Map<string, ElementEntry>()
  let top: number | null | undefined
  let figures = 0
  let tables = 0
  for (const chapter of chapters) {
    if (chapter.top !== top) {
      top = chapter.top
      figures = 0
      tables = 0
    }
    starts.set(chapter.id, { chapter: chapter.top, figures, tables })
    const counts = { figure: 0, table: 0 }
    for (const element of elements(chapter.id)) {
      const number = element.kind === 'figure' ? ++figures : ++tables
      const entry: ElementEntry = {
        ...element,
        chapterId: chapter.id,
        index: counts[element.kind]++,
        label: elementLabel(element.kind, chapter.top, number),
      }
      entries.push(entry)
      const key = `${element.kind}:${element.id}`
      if (element.id !== null && !byId.has(key)) byId.set(key, entry)
    }
  }
  return {
    entries,
    start: (chapterId) => starts.get(chapterId) ?? NO_ELEMENT_START,
    find: (kind, id) => byId.get(`${kind}:${id}`) ?? null,
  }
}

/** 一个章节中各图表显示的编号（按位置），用于编辑器与全文阅读中的标注。 */
export function chapterLabels(doc: Node, start: ElementStart): Map<number, string> {
  const labels = new Map<number, string>()
  let figures = start.figures
  let tables = start.tables
  for (const element of elementsOf(doc)) {
    const number = element.kind === 'figure' ? ++figures : ++tables
    labels.set(element.pos, elementLabel(element.kind, start.chapter, number))
  }
  return labels
}
