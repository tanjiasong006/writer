import type { Meta, StoryObj } from '@storybook/vue3-vite'
import TextPopover from './TextPopover.vue'

const meta = {
  title: 'UI/Editor/TextPopover',
  component: TextPopover,
  parameters: { layout: 'fullscreen' },
  args: { anchor: { x: 160, y: 120 }, label: '脚注 3', text: '', placeholder: '脚注内容' },
} satisfies Meta<typeof TextPopover>

export default meta
type Story = StoryObj<typeof meta>

/** 插入新脚注：空内容。 */
export const New: Story = {}

/** 编辑已有脚注：较长的内容自动增高。 */
export const Editing: Story = {
  args: { text: '方法设计参考了《社会调查研究方法》第三版，问卷题目在预调查后做了两轮修订，具体变化见附录 B 的对照表。' },
}

/** 表格标题。 */
export const TableCaption: Story = { args: { label: '表格标题', placeholder: '表格标题', text: '样本构成' } }

/** 靠近窗口底部：浮层在上方弹出。 */
export const NearBottom: Story = { args: { anchor: { x: 160, y: 2000 }, text: '剔除无效问卷后的数量。' } }
