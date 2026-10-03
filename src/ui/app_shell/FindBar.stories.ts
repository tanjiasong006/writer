import type { Meta, StoryObj } from '@storybook/vue3-vite'
import FindBar from './FindBar.vue'

const meta = {
  title: 'UI/AppShell/FindBar',
  component: FindBar,
  parameters: { layout: 'fullscreen' },
  args: {
    query: '样本',
    replacement: '',
    scope: 'chapter',
    showReplace: false,
    total: 12,
    position: 3,
    replacedCount: null,
  },
} satisfies Meta<typeof FindBar>

export default meta
type Story = StoryObj<typeof meta>

/** 查找中，选中第 3 处。 */
export const Finding: Story = {}

/** 刚打开，还没有输入。 */
export const Empty: Story = { args: { query: '', total: 0, position: null } }

/** 没有匹配：数量以警示色说明。 */
export const NoResults: Story = { args: { query: '不存在的词', total: 0, position: null } }

/** 展开替换，全文范围。 */
export const Replace: Story = { args: { showReplace: true, scope: 'document', replacement: '案例', position: null } }

/** 全部替换之后。 */
export const Replaced: Story = { args: { showReplace: true, replacement: '案例', total: 0, position: null, replacedCount: 12 } }
