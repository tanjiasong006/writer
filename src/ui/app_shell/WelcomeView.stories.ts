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
