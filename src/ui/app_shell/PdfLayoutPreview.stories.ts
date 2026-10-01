import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PdfLayoutPreview from './PdfLayoutPreview.vue'
import { samplePdfPreview } from '../../testing/sample_pdf_preview.ts'

/** PDF 样张：排版中、已出结果、失败。页面由 Storybook 近似画出，不是真实排版。 */
const meta = {
  title: 'UI/AppShell/PdfLayoutPreview',
  component: PdfLayoutPreview,
  decorators: [() => ({ template: '<div style="display:flex;width:264px;height:560px;padding:24px"><story style="flex:1" /></div>' })],
} satisfies Meta<typeof PdfLayoutPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  args: { settings: {}, preview: samplePdfPreview(0) },
}

/** 第一次排版尚未完成：按纸张比例的空白页，稍后出现"正在排版…"。 */
export const Loading: Story = {
  args: { settings: { paper: 'b5' }, preview: () => new Promise(() => {}) },
}

export const Failed: Story = {
  args: { settings: {}, preview: async () => ({ ok: false, error: { code: 'render-failed', message: 'x' } }) },
}

export const NoCjkFont: Story = {
  args: { settings: {}, preview: async () => ({ ok: false, error: { code: 'no-cjk-font' } }) },
}
