import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WelcomeView from './WelcomeView.vue'

const meta = {
  title: 'UI/AppShell/WelcomeView',
  component: WelcomeView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WelcomeView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: {} }
export const Busy: Story = { args: { busy: true } }
export const OpenFailed: Story = {
  args: { error: '章节正文文件 content/ch_2.md 不存在，为避免覆盖数据已停止打开。' },
}

/** 最近打开的文档：名称与路径（过长时省略开头），单击打开。 */
export const WithRecent: Story = {
  args: {
    recent: [
      '/Users/me/Documents/毕业论文',
      '/Users/me/Documents/工作/2026 年度报告',
      '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/写作/长篇小说初稿与修改记录',
    ],
  },
}
