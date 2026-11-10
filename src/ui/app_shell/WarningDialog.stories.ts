import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WarningDialog from './WarningDialog.vue'

const meta = {
  title: 'UI/AppShell/WarningDialog',
  component: WarningDialog,
  parameters: { layout: 'fullscreen' },
  args: { title: '导入完成，但有部分内容未能保留', warnings: ['文档中的表格未导入。'] },
} satisfies Meta<typeof WarningDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = {}
export const Multiple: Story = {
  args: { warnings: ['文档中的表格未导入。', '部分图片无法读取。', '标题中的图片未导入。'] },
}
export const WordImport: Story = {
  args: {
    title: 'Word 导入已完成，存在以下警告',
    description: '请对照原文检查以下内容。',
    warnings: ['第 2 个正文块（table）：部分表格没有明确的 Word 表头，已将第一行作为表头。', '第 4 个正文块，第 2 个表格，第 2 行，第 1 个单元格（image）：部分图片无法读取，未导入。 附近文字：实验结果', '未识别的导入警告：future_warning'],
  },
}
export const LongList: Story = {
  args: { warnings: Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 处内容未能导入，请检查原始文档。`) },
}
