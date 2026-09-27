import type { ChapterId, ChapterTree } from '../chapter_tree/chapter_tree.ts'

/**
 * 一个章节的层级编号，从根到该章节的各级序号（从 1 开始）。
 * 例如根下第 1 个章节的第 2 个子节点是 [1, 2]，显示为 "1.2"。
 * 这里只表达结构，具体显示格式（分隔符等）由 UI 层决定。
 */
export type ChapterNumber = readonly number[]

/**
 * 根据章节树结构计算每个章节的编号。
 *
 * - 输入是一棵已通过 validateTree 的可信树。
 * - 编号完全由位置推导，不读取也不写入 ChapterNode。
 * - 纯函数：不修改传入的树，返回全新的 Map。
 * - 空树返回空 Map。
 */
export function computeChapterNumbers(
  tree: ChapterTree,
): ReadonlyMap<ChapterId, ChapterNumber> {
  const numbers = new Map<ChapterId, ChapterNumber>()

  const visit = (nodes: ChapterTree, prefix: ChapterNumber): void => {
    nodes.forEach((node, i) => {
      const number = [...prefix, i + 1]
      numbers.set(node.id, number)
      visit(node.children, number)
    })
  }

  visit(tree, [])
  return numbers
}
