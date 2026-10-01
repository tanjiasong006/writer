import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PdfPageViewer from './PdfPageViewer.vue'

/** 样张的全尺寸查看：各页按实际尺寸竖向排列，打开时定位到第 2 页。页面为占位，不是真实排版。 */
const meta = {
  title: 'UI/AppShell/PdfPageViewer',
  component: PdfPageViewer,
  parameters: { layout: 'fullscreen' },
  decorators: [() => ({ template: '<div style="height:760px"><story /></div>' })],
} satisfies Meta<typeof PdfPageViewer>

export default meta
type Story = StoryObj<typeof meta>

const page = (n: number) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595.28 841.89" width="595.28pt" height="841.89pt"><rect width="100%" height="100%" fill="#fff"/><text x="72" y="120" font-size="18" font-family="sans-serif">第 ${n} 页</text></svg>`
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width: 595.28, height: 841.89 }
}

export const A4: Story = {
  args: { pages: [page(1), page(2), page(3)], start: 1 },
}
