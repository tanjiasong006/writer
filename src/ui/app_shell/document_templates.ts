import type { OutlineChapter } from '../../application/project_lifecycle.ts'

/**
 * 新建文档的模板（docs/decisions.md 第 19 节）：只预先建好常见的章节结构，写作提示放在章节备注中。
 * 章节编号自动生成，标题中不写编号；参考文献表由导出自动生成，不作为章节。
 */
export type TemplateId = 'thesis' | 'report' | 'book'

export interface DocumentTemplate {
  readonly id: TemplateId
  readonly label: string
  readonly outline: readonly OutlineChapter[]
}

export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    id: 'thesis',
    label: '论文',
    outline: [
      {
        title: '绪论',
        note: '交代研究背景与意义、要解决的问题和全文结构。',
        children: [{ title: '研究背景' }, { title: '研究内容' }, { title: '论文结构' }],
      },
      { title: '相关工作', note: '梳理已有研究，指出与本文的关系和不足。' },
      { title: '研究方法', note: '说明方法、模型或设计，以及这样选择的理由。' },
      { title: '实验与结果', note: '实验设置、数据与结果；图表加题注后可在正文中按编号引用。' },
      { title: '讨论', note: '解释结果的含义、局限与可能的改进。' },
      { title: '结论与展望', note: '总结主要结论与贡献，提出后续工作。' },
    ],
  },
  {
    id: 'report',
    label: '报告',
    outline: [
      { title: '概述', note: '一段话说明报告的目的、主要结论与建议，供只读这一章的读者。' },
      { title: '背景与目标' },
      { title: '现状分析', note: '用数据和事实说明现状与问题。' },
      { title: '方案', note: '可选方案及比较，给出推荐方案。' },
      { title: '实施计划', note: '步骤、时间、分工与所需资源。' },
      { title: '风险与应对' },
      { title: '结论与建议' },
    ],
  },
  {
    id: 'book',
    label: '书稿',
    outline: [
      { title: '序言', note: '写作缘起、读者对象与阅读建议。' },
      { title: '', note: '每章围绕一个主题；章下可以再分小节。' },
      { title: '' },
      { title: '' },
      { title: '后记' },
    ],
  },
]

export function findTemplate(id: string): DocumentTemplate | null {
  return DOCUMENT_TEMPLATES.find((template) => template.id === id) ?? null
}
