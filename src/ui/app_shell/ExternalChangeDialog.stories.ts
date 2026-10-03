import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ExternalChangeDialog from './ExternalChangeDialog.vue'

const meta = {
  title: 'UI/AppShell/ExternalChangeDialog',
  component: ExternalChangeDialog,
  parameters: { layout: 'fullscreen' },
  args: { chapters: ['2.1 研究方法', '3 结果与讨论'], structure: false },
} satisfies Meta<typeof ExternalChangeDialog>

export default meta
type Story = StoryObj<typeof meta>

/** 两边都修改了正文。 */
export const ChapterConflicts: Story = {}

/** 章节结构或标题被修改。 */
export const Structure: Story = { args: { chapters: [], structure: true } }
