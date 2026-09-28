import type { Meta, StoryObj } from '@storybook/vue3-vite'
import EditorToolbar from './EditorToolbar.vue'

const meta = {
  title: 'UI/Editor/EditorToolbar',
  component: EditorToolbar,
  tags: ['autodocs'],
} satisfies Meta<typeof EditorToolbar>

export default meta
type Story = StoryObj<typeof meta>

/** 工具栏：粗体、斜体、列表、引用、代码块、表格、图片。点击会发出 command 事件。 */
export const Default: Story = {}
