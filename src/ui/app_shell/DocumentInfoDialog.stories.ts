import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentInfoDialog from './DocumentInfoDialog.vue'

/** 文档信息对话框：标题、副标题、作者。Enter 完成，Esc 取消，Tab 只在对话框内循环。 */
const meta = {
  title: 'UI/AppShell/DocumentInfoDialog',
  component: DocumentInfoDialog,
  parameters: { layout: 'fullscreen' },
  decorators: [() => ({ template: '<div style="height:520px"><story /></div>' })],
} satisfies Meta<typeof DocumentInfoDialog>

export default meta
type Story = StoryObj<typeof meta>

/** 新文档：只有标题，副标题与作者显示占位文字"无"。 */
export const Empty: Story = {
  args: { info: { title: '示例论文', subtitle: '', author: '' } },
}

export const Filled: Story = {
  args: { info: { title: '示例论文', subtitle: '一项关于长文档写作的研究', author: '张三' } },
}

/** 很长的标题与副标题：输入框内横向滚动，对话框宽度不变。 */
export const LongValues: Story = {
  args: {
    info: {
      title: '基于多源遥感数据的长江中下游湖泊湿地时空演变与驱动机制研究',
      subtitle: '博士学位论文终稿（提交答辩委员会审阅版本，含全部附录与补充材料）',
      author: '张三、李四、王五',
    },
  },
}
