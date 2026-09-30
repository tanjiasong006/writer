import type { Meta, StoryObj } from '@storybook/vue3-vite'
import Toast from './Toast.vue'

const meta = {
  title: 'UI/Common/Toast',
  component: Toast,
  render: (args) => ({
    components: { Toast },
    setup: () => ({ args }),
    template: `<div style="padding: 24px; background: var(--color-bg)"><Toast v-bind="args">{{ args.message }}<template v-if="args.action" #actions><button type="button">{{ args.action }}</button></template></Toast></div>`,
  }),
} satisfies Meta<typeof Toast>

export default meta
type Story = StoryObj<typeof meta>

/** 操作完成：带一个文字操作。 */
export const WithAction: Story = {
  args: { message: '已导出 毕业论文.docx', action: '在文件夹中显示' } as never,
}

/** 错误：危险色文字，读屏立即读出。 */
export const Error: Story = {
  args: { tone: 'error', message: '图片格式不受支持：请使用 PNG、JPG 或 GIF。' } as never,
}

/** 长文字折行，关闭按钮保持在右侧。 */
export const LongMessage: Story = {
  args: { message: 'content 文件夹中有 3 个未被文档引用的文件，已原样保留。它们不会出现在导出中，也不会被删除。' } as never,
}
