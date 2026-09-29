import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentTitle from './DocumentTitle.vue'

/** 工具栏开头的文档名：指针经过时出现箭头，点击发出 menu；重命名在原处进行。 */
const meta = {
  title: 'UI/AppShell/DocumentTitle',
  component: DocumentTitle,
  parameters: { layout: 'padded' },
  decorators: [() => ({ template: '<div style="display:flex;width:360px;height:52px;align-items:center"><story /></div>' })],
} satisfies Meta<typeof DocumentTitle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { title: '示例论文' } }

/** 很长的文档名：单行截断，完整名称在指针停留时显示。 */
export const LongTitle: Story = {
  args: { title: '基于多源遥感数据的长江中下游湖泊湿地时空演变与驱动机制研究（博士学位论文终稿）' },
}

/** 重命名：输入框占据标题原来的位置，Enter 确认、Esc 放弃。 */
export const Renaming: Story = {
  args: { title: '示例论文' },
  play: async ({ canvasElement }) => {
    const vm = (canvasElement.querySelector('.document-title') as unknown as { __vueParentComponent: { exposed: { startRename(): void } } })
      .__vueParentComponent
    vm.exposed.startRename()
  },
}
