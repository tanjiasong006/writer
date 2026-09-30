import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'

/** 章节树中的一行显示。 */
export interface ChapterRow {
  readonly id: ChapterId
  readonly title: string
  /** 显示用编号，如 "2.1"。 */
  readonly number: string
  /** 层级，根章节为 0。 */
  readonly depth: number
  readonly hasChildren: boolean
}

/** 把树摊平成带层级的显示行；折叠节点不展开其后代。 */
export function visibleRows(tree: ChapterTree, collapsedIds: ReadonlySet<ChapterId>): ChapterRow[] {
  const numbers = computeChapterNumbers(tree)
  const result: ChapterRow[] = []

  const visit = (nodes: ChapterTree, depth: number): void => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0
      result.push({
        id: node.id,
        title: node.title,
        number: (numbers.get(node.id) ?? []).join('.'),
        depth,
        hasChildren,
      })
      if (hasChildren && !collapsedIds.has(node.id)) visit(node.children, depth + 1)
    }
  }

  visit(tree, 0)
  return result
}

/** 返回从根到 id 的祖先 id 列表（不含 id 本身）；找不到返回 null。 */
export function ancestorPath(nodes: ChapterTree, id: ChapterId): ChapterId[] | null {
  for (const node of nodes) {
    if (node.id === id) return []
    const childPath = ancestorPath(node.children, id)
    if (childPath !== null) return [node.id, ...childPath]
  }
  return null
}

/** 同级编号的分组键："2.1.3" → "2.1"，根章节为 ""。 */
function siblingKey(number: string): string {
  return number.slice(0, Math.max(0, number.lastIndexOf('.')))
}

/**
 * 每一行编号的最小宽度（CSS）。同一父章节下的编号占同样的宽度（按其中最长的编号），
 * "1.9"与"1.10"之后的标题左端对齐，密集的层级更容易扫读。
 * 编号用等宽数字：宽度按数字个数（ch）加分隔点估算（同级编号的点数相同）。
 */
export function numberWidths(rows: readonly ChapterRow[]): ReadonlyMap<ChapterId, string> {
  const digits = new Map<string, number>()
  for (const row of rows) {
    const key = siblingKey(row.number)
    digits.set(key, Math.max(digits.get(key) ?? 0, row.number.replace(/\./g, '').length))
  }
  return new Map(
    rows.map((row) => [row.id, `calc(${digits.get(siblingKey(row.number)) ?? 0}ch + ${row.depth} * 0.3em)`]),
  )
}
