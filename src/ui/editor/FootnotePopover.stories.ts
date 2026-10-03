import type { Meta, StoryObj } from '@storybook/vue3-vite'
import FootnotePopover from './FootnotePopover.vue'

const meta = {
  title: 'UI/Editor/FootnotePopover',
  component: FootnotePopover,
  parameters: { layout: 'fullscreen' },
  args: { anchor: { x: 160, y: 120 }, number: 3, text: '' },
} satisfies Meta<typeof FootnotePopover>

export default meta
type Story = StoryObj<typeof meta>

/** 插入新脚注：空内容。 */
export const New: Story = {}

/** 编辑已有脚注：较长的内容自动增高。 */
export const Editing: Story = {
  args: { text: '方法设计参考了《社会调查研究方法》第三版，问卷题目在预调查后做了两轮修订，具体变化见附录 B 的对照表。' },
}

/** 靠近窗口底部：浮层在上方弹出。 */
export const NearBottom: Story = { args: { anchor: { x: 160, y: 2000 }, text: '剔除无效问卷后的数量。' } }
