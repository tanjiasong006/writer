import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MathPopover from './MathPopover.vue'

const meta = {
  title: 'UI/Editor/MathPopover',
  component: MathPopover,
  parameters: { layout: 'fullscreen' },
  args: { anchor: { x: 160, y: 120 }, label: '行内公式', tex: '', display: false },
} satisfies Meta<typeof MathPopover>

export default meta
type Story = StoryObj<typeof meta>

/** 插入新公式：空内容。 */
export const New: Story = {}

/** 编辑公式块：下方是实时预览。 */
export const EditingBlock: Story = {
  args: { label: '公式块', display: true, tex: '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}' },
}

/** 写错时预览以红色说明。 */
export const Invalid: Story = { args: { tex: '\\frac{a' } }
