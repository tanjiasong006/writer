import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ChapterTree from './ChapterTree.vue'
import type { ChapterTree as ChapterTreeModel } from '../../domain/chapter_tree/chapter_tree.ts'

const outline: ChapterTreeModel = [
  { id: 'intro', title: '引言', children: [] },
  { id: 'part-1', title: '第一部分 基础', children: [] },
]

const nested: ChapterTreeModel = [
  {
    id: 'part-1',
    title: '第一部分 基础',
    children: [
      { id: 'ch-1', title: '第一章 起步', children: [
        { id: 'sec-1-1', title: '1.1 环境准备', children: [] },
        { id: 'sec-1-2', title: '1.2 第一个程序', children: [] },
      ] },
      { id: 'ch-2', title: '第二章 进阶', children: [
        { id: 'sec-2-1', title: '2.1 数据流', children: [
          { id: 'sec-2-1-1', title: '2.1.1 单向流动', children: [] },
        ] },
      ] },
    ],
  },
  { id: 'appendix', title: '附录', children: [] },
]

const meta = {
  title: 'UI/ChapterTree',
  component: ChapterTree,
  tags: ['autodocs'],
  render: (args) => ({
    components: { ChapterTree },
    setup: () => ({ args }),
    template: '<ChapterTree v-bind="args" />',
  }),
} satisfies Meta<typeof ChapterTree>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { tree: outline, selectedId: null },
}

export const Nested: Story = {
  args: { tree: nested, selectedId: null },
}

export const Selected: Story = {
  args: { tree: nested, selectedId: 'sec-1-2' },
}

export const Collapsed: Story = {
  args: { tree: nested, selectedId: null },
  play: async ({ canvasElement }) => {
    const toggles = canvasElement.querySelectorAll<HTMLButtonElement>(
      '.chapter-tree__toggle[aria-expanded="true"]',
    )
    for (const toggle of toggles) toggle.click()
  },
}

/** 直接拖动章节行，观察插入线与 inside 高亮；本阶段松手不会改变树。 */
export const DragAndDrop: Story = {
  args: { tree: nested, selectedId: null },
}
