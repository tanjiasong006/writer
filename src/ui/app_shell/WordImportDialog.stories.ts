import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WordImportDialog from './WordImportDialog.vue'

const meta = {
  title: 'UI/AppShell/WordImportDialog',
  component: WordImportDialog,
  parameters: { layout: 'fullscreen' },
  args: { filePath: '', projectName: '', targetDirectory: '' },
} satisfies Meta<typeof WordImportDialog>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const Ready: Story = { args: { filePath: '/Users/example/Documents/论文.docx', projectName: '论文', targetDirectory: '/Users/example/Documents' } }
export const Busy: Story = { args: { ...Ready.args, busy: true } }
export const Error: Story = { args: { ...Ready.args, error: '导入没有完成。目标目录中可能残留不完整的项目，请检查后再重试。' } }
export const LongPaths: Story = { args: { filePath: '/Users/example/Documents/一个很长的文件夹名称/一个很长的 Word 文档名称.docx', projectName: '示例项目', targetDirectory: '/Users/example/Documents/一个很长的文件夹名称/另一个很长的文件夹名称' } }
