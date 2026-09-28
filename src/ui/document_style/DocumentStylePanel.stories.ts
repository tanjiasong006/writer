import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import DocumentStylePanel from './DocumentStylePanel.vue'
import {
  defaultDocumentStyle,
  overrideStyle,
  resetOverrides,
  selectTheme,
  type DocumentStyle,
} from '../../domain/document_style/document_style.ts'

const meta = {
  title: 'UI/DocumentStyle/DocumentStylePanel',
  component: DocumentStylePanel,
  // 模拟上层：把选择应用到样式上，行为与工作区一致。
  render: (args) => ({
    components: { DocumentStylePanel },
    setup() {
      const style = ref<DocumentStyle>(args.documentStyle)
      return {
        style,
        selectTheme: (id: Parameters<typeof selectTheme>[1]) => (style.value = selectTheme(style.value, id)),
        override: (patch: Parameters<typeof overrideStyle>[1]) => (style.value = overrideStyle(style.value, patch)),
        reset: () => (style.value = resetOverrides(style.value)),
      }
    },
    template:
      '<div style="display: inline-block; border: 1px solid #e5e7eb; border-radius: 6px"><DocumentStylePanel :document-style="style" @select-theme="selectTheme" @override="override" @reset="reset" /></div>',
  }),
} satisfies Meta<typeof DocumentStylePanel>

export default meta
type Story = StoryObj<typeof meta>

/** 默认主题，没有调整。 */
export const Default: Story = {
  args: { documentStyle: defaultDocumentStyle() },
}

/** 在主题之上调整了正文字体与字号：显示"恢复主题默认"。 */
export const Adjusted: Story = {
  args: { documentStyle: overrideStyle(defaultDocumentStyle(), { bodyFont: 'sans', bodySize: 10.5, heading1Size: 18 }) },
}

/** 技术文档主题。 */
export const Technical: Story = {
  args: { documentStyle: selectTheme(defaultDocumentStyle(), 'technical') },
}
