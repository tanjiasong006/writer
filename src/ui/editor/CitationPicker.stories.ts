import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CitationPicker from './CitationPicker.vue'
import { emptyReference } from '../../domain/bibliography/bibliography.ts'

const references = [
  { ...emptyReference('b1', 'book'), author: '张三；李四', title: '长文档写作', place: '北京', publisher: '某出版社', year: '2020' },
  { ...emptyReference('a1', 'article'), author: '王五', title: '结构化写作中的章节组织与交叉引用', container: '编辑学报', year: '2021', volume: '33', issue: '2', pages: '5-9' },
  { ...emptyReference('w1', 'web'), author: 'Writer Team', title: 'Writer 使用说明', container: 'Writer', year: '2026', url: 'https://example.com/docs/writer/long-document-writing' },
]

const meta = {
  title: 'UI/Editor/CitationPicker',
  component: CitationPicker,
  parameters: { layout: 'fullscreen' },
  args: { references, numbers: new Map([['a1', 1]]), anchor: { x: 200, y: 120 } },
} satisfies Meta<typeof CitationPicker>

export default meta
type Story = StoryObj<typeof meta>

/** 已被引用的文献显示编号；长条目最多两行。 */
export const List: Story = {}

/** 更改已有引用：预先选中它当前的文献。 */
export const Change: Story = { args: { current: 'w1' } }

/** 还没有文献：说明并提供“添加文献…”。 */
export const Empty: Story = { args: { references: [], numbers: new Map() } }
