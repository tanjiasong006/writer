import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ReferencesDialog from './ReferencesDialog.vue'
import { emptyReference } from '../../domain/bibliography/bibliography.ts'

const references = [
  { ...emptyReference('b1', 'book'), author: '张三；李四', title: '长文档写作', place: '北京', publisher: '某出版社', year: '2020', pages: '12-20' },
  { ...emptyReference('a1', 'article'), author: '王五', title: '结构化写作中的章节组织与交叉引用', container: '编辑学报', year: '2021', volume: '33', issue: '2', pages: '5-9' },
  { ...emptyReference('t1', 'thesis'), author: '赵六', title: '长文档编辑器的设计', place: '上海', publisher: '某大学', year: '2019' },
]

const meta = {
  title: 'UI/AppShell/ReferencesDialog',
  component: ReferencesDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    references,
    numbers: new Map([['a1', 1], ['b1', 2]]),
    confirmDelete: async () => true,
    citationCount: () => 0,
  },
} satisfies Meta<typeof ReferencesDialog>

export default meta
type Story = StoryObj<typeof meta>

/** 编辑一条期刊文章。 */
export const EditArticle: Story = { args: { initial: 'a1' } }

/** 学位论文的字段。 */
export const Thesis: Story = { args: { initial: 't1' } }

/** 还没有文献。 */
export const Empty: Story = { args: { references: [], numbers: new Map() } }
