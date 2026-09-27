import type { Meta, StoryObj } from '@storybook/vue3-vite'
import App from './App.vue'

const meta = {
  title: 'App',
  component: App,
  tags: ['autodocs'],
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

/**
 * 应用入口：可选中章节、拖拽移动章节。
 * 把「第一章」拖到它自己的「第一节」里会看到 UI 层的失败反馈。
 */
export const Default: Story = {}
