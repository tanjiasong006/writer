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

/** 切换编辑方式（浮层在本次运行中记住上次的方式）。 */
function showSource(canvas: HTMLElement, source: boolean): void {
  const toggle = canvas.ownerDocument.querySelector<HTMLElement>('.math-popover__mode')
  if (toggle && (toggle.getAttribute('aria-pressed') === 'true') !== source) toggle.click()
}

/** 插入新公式：空的可视编辑器，上方是常用结构。 */
export const New: Story = { play: ({ canvasElement }) => showSource(canvasElement, false) }

/** 编辑公式块：直接编辑排好版的公式。 */
export const EditingBlock: Story = {
  args: { label: '公式块', display: true, tex: '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}' },
  play: ({ canvasElement }) => showSource(canvasElement, false),
}

/** 打开符号面板。 */
export const Symbols: Story = {
  args: { tex: 'a \\le b' },
  play: ({ canvasElement }) => {
    showSource(canvasElement, false)
    canvasElement.ownerDocument.querySelector<HTMLElement>('.math-popover__tool--text')?.click()
  },
}

/** LaTeX 源码：文本框与实时预览。 */
export const Source: Story = {
  args: { label: '公式块', display: true, tex: '\\begin{aligned} f(x) &= x^2 \\\\ g(x) &= 2x \\end{aligned}' },
  play: ({ canvasElement }) => showSource(canvasElement, true),
}

/** LaTeX 源码中写错时，预览以红色说明。 */
export const Invalid: Story = {
  args: { tex: '\\frac{a' },
  play: ({ canvasElement }) => showSource(canvasElement, true),
}
