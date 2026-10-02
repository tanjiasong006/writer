import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ChapterRefReportDialog from './ChapterRefReportDialog.vue'

const names: Record<string, string> = { a1: '1.1 研究背景', b: '2 研究方法', c3: '3.3 城市更新中的社区公共空间使用与评价' }

const meta = {
  title: 'UI/AppShell/ChapterRefReportDialog',
  component: ChapterRefReportDialog,
  parameters: { layout: 'fullscreen' },
  args: { chapterName: (id: string) => names[id] ?? id },
} satisfies Meta<typeof ChapterRefReportDialog>

export default meta
type Story = StoryObj<typeof meta>

/** 更新了引用文字，另有失效引用（单击跳到所在位置）。 */
export const UpdatedWithBroken: Story = {
  args: {
    chapters: 3,
    updated: 7,
    broken: [
      { chapterId: 'a1', index: 1, text: '4.2 讨论', before: '相关的分析见', after: '一节，这里只给出结论…' },
      { chapterId: 'b', index: 0, text: '附录 B', before: '编码手册见', after: '。' },
      { chapterId: 'c3', index: 2, text: '旧的结论', before: '…与', after: '不同，样本扩大后差异变得不再显著，需要进一步说明原因与可能的偏差…' },
    ],
  },
}

/** 所有引用都是最新的。 */
export const UpToDate: Story = {
  args: { chapters: 0, updated: 0, broken: [] },
}

/** 没有需要更新的文字，只有失效引用。 */
export const OnlyBroken: Story = {
  args: { chapters: 0, updated: 0, broken: [{ chapterId: 'b', index: 0, text: '附录 B', before: '编码手册见', after: '。' }] },
}
