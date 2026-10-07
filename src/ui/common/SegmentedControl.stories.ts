import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import SegmentedControl from './SegmentedControl.vue'

/** 分段控件：少量互斥选项中选一个。←/→ 移动并选中，整组只占一个 Tab 位置。 */
const meta: Meta = {
  title: 'UI/Common/SegmentedControl',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

function story(label: string, initial: string | null, options: { value: string; label: string }[], disabled = false): Story {
  return {
    render: () => ({
      components: { SegmentedControl },
      setup: () => ({ value: ref<string | null>(initial), label, options, disabled }),
      template: '<SegmentedControl v-model="value" :label="label" :options="options" :disabled="disabled" />',
    }),
  }
}

const MARGINS = [
  { value: 'narrow', label: '窄' },
  { value: 'normal', label: '标准' },
  { value: 'wide', label: '宽' },
]

export const Default = story('页边距', 'normal', MARGINS)

export const ManyOptions = story('纸张', 'a4', [
  { value: 'a4', label: 'A4' },
  { value: 'b5', label: 'B5' },
  { value: 'a5', label: 'A5' },
  { value: 'letter', label: 'Letter' },
])

/** 不可用：整组变淡，不进入 Tab 顺序。 */
export const Disabled = story('目录层级', 'normal', MARGINS, true)

/** 没有选中项（如配置改过、不等于任何版式）：第一项占 Tab 位置。 */
export const NoSelection = story('版式', null, [
  { value: 'standard', label: '标准' },
  { value: 'academic', label: '学术' },
  { value: 'book', label: '书籍' },
  { value: 'minimal', label: '简洁' },
])
