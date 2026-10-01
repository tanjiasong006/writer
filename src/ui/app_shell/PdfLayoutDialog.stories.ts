import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PdfLayoutDialog from './PdfLayoutDialog.vue'
import { samplePdfPreview } from '../../testing/sample_pdf_preview.ts'

/** PDF 排版设置：左侧样张随设置重新排版（Storybook 中为近似页面）；修改作用于草稿，完成 / 导出时提交。 */
const meta = {
  title: 'UI/AppShell/PdfLayoutDialog',
  component: PdfLayoutDialog,
  parameters: { layout: 'fullscreen' },
  decorators: [() => ({ template: '<div style="height:760px"><story /></div>' })],
} satisfies Meta<typeof PdfLayoutDialog>

export default meta
type Story = StoryObj<typeof meta>

/** 从"导出为 PDF…"进入，全部为默认值："恢复默认"不可用。 */
export const ExportDefaults: Story = {
  args: { settings: {}, action: 'export', preview: samplePdfPreview() },
}

/** 从菜单进入，改过多项：B5、双面、段间空行、网格表、无目录、第 1 章、1 / N。 */
export const Customized: Story = {
  args: {
    action: 'save',
    preview: samplePdfPreview(),
    settings: {
      paper: 'b5',
      binding: 'double',
      paragraph: 'spacing',
      table: 'grid',
      toc: false,
      chapterNumber: 'chapter',
      pageNumber: 'total',
      lineHeight: 'loose',
    },
  },
}

/** Letter、窄边距、无页眉、第 1 页。 */
export const WideLetter: Story = {
  args: { action: 'export', preview: samplePdfPreview(), settings: { paper: 'letter', margin: 'narrow', header: 'none', pageNumber: 'page' } },
}
