import { createDocument, type WriterDocument } from '../domain/document/document.ts'

/** Storybook 与手动调试用的示例文档。 */
export function sampleDocument(): WriterDocument {
  const result = createDocument(
    '示例论文',
    [
      {
        id: 'ch-1',
        title: '绪论',
        children: [
          { id: 'ch-1-1', title: '研究背景', children: [] },
          { id: 'ch-1-2', title: '研究意义', children: [] },
        ],
      },
      {
        id: 'ch-2',
        title: '研究方法',
        children: [{ id: 'ch-2-1', title: '实验设计', children: [] }],
      },
      { id: 'ch-3', title: '结论', children: [] },
    ],
    new Map([
      ['ch-1', '本章介绍研究的背景与意义。\n'],
      ['ch-1-1', '长文档写作需要**清晰的结构**。\n\n- 章节组织\n- 自动编号\n'],
      ['ch-1-2', ''],
      ['ch-2', '> 方法决定结果。\n'],
      ['ch-2-1', '| 组别 | 样本数 |\n| --- | --- |\n| 对照组 | 30 |\n| 实验组 | 32 |\n'],
      ['ch-3', ''],
    ]),
  )
  if (!result.ok) throw new Error('sample document is inconsistent')
  return result.document
}

/**
 * 大文档：parts 个一级章节，每个下有 sectionsPerPart 个二级章节，每章约 2000 字正文。
 * 用于 Storybook 中人工检查与测量大文档下的交互性能。
 */
export function largeDocument(parts = 50, sectionsPerPart = 20): WriterDocument {
  const paragraph = '长文档写作需要清晰的结构与稳定的输出。'.repeat(20)
  const body = Array.from({ length: 5 }, () => paragraph).join('\n\n')
  const tree = Array.from({ length: parts }, (_, p) => ({
    id: `p${p}`,
    title: `第 ${p + 1} 部分`,
    children: Array.from({ length: sectionsPerPart }, (_, s) => ({
      id: `p${p}-s${s}`,
      title: `小节 ${s + 1}`,
      children: [],
    })),
  }))
  const contents = new Map<string, string>()
  for (const part of tree) {
    contents.set(part.id, body)
    for (const section of part.children) contents.set(section.id, body)
  }
  const result = createDocument('大文档', tree, contents)
  if (!result.ok) throw new Error('large document is inconsistent')
  return result.document
}
