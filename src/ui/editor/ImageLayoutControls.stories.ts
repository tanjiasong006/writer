import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ImageLayoutControls from './ImageLayoutControls.vue'

const meta = {
  title: 'UI/Editor/ImageLayoutControls',
  component: ImageLayoutControls,
  tags: ['autodocs'],
} satisfies Meta<typeof ImageLayoutControls>

export default meta
type Story = StoryObj<typeof meta>

/** 跟随默认主题的图片：原始尺寸、居中。点击发出 change（只含被修改的字段）。 */
export const Default: Story = {
  args: { layout: { size: 'original', align: 'center' } },
}

/** 设置为小图、靠右。 */
export const SmallRight: Story = {
  args: { layout: { size: 'small', align: 'right' } },
}

/** 通栏。 */
export const Full: Story = {
  args: { layout: { size: 'full', align: 'center' } },
}
