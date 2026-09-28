import type { Meta, StoryObj } from '@storybook/vue3-vite'
import EditorToolbar from './EditorToolbar.vue'
import ImageLayoutControls from './ImageLayoutControls.vue'

const meta = {
  title: 'UI/Editor/EditorToolbar',
  component: EditorToolbar,
  tags: ['autodocs'],
} satisfies Meta<typeof EditorToolbar>

export default meta
type Story = StoryObj<typeof meta>

/** 工具栏：粗体、斜体、列表、引用、代码块、表格、图片。点击会发出 command 事件。 */
export const Default: Story = {}

const idle = { enabled: true, active: false }

/** 光标在列表中的粗体文字上：粗体与无序列表按下。 */
export const ActiveFormats: Story = {
  args: {
    state: {
      bold: { enabled: true, active: true },
      italic: idle,
      'bullet-list': { enabled: true, active: true },
      'ordered-list': idle,
      quote: idle,
      'code-block': idle,
      table: idle,
      image: idle,
    },
  },
}

/** 光标在代码块中：格式与插入不可用，代码块按下。 */
export const InCodeBlock: Story = {
  args: {
    state: {
      bold: { enabled: false, active: false },
      italic: { enabled: false, active: false },
      'bullet-list': idle,
      'ordered-list': idle,
      quote: idle,
      'code-block': { enabled: true, active: true },
      table: { enabled: false, active: false },
      image: { enabled: false, active: false },
    },
  },
}

/** 选中图片时：工具栏右侧出现图片布局按钮（context 插槽）；窄窗口中换到第二行。 */
export const WithImageSelected: Story = {
  render: (args) => ({
    components: { EditorToolbar, ImageLayoutControls },
    setup: () => ({ args }),
    template:
      '<EditorToolbar v-bind="args"><template #context><ImageLayoutControls :layout="{ size: \'large\', align: \'center\' }" /></template></EditorToolbar>',
  }),
}
