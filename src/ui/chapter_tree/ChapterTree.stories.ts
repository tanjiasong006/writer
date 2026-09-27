import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import ChapterTree from './ChapterTree.vue'
import type { ChapterTree as ChapterTreeModel } from '../../domain/chapter_tree/chapter_tree.ts'
import { moveChapterTo, type MoveIntent } from '../../application/move_chapter.ts'

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

/** 空树：显示空状态与「新建第一个章节」。 */
export const Empty: Story = {
  args: { tree: [], selectedId: null },
}

/** 深层级 + 超长标题：检查 16px 缩进、编号弱化与标题省略号。 */
const deepAndLong: ChapterTreeModel = [
  {
    id: 'c1',
    title: '第一章 这是一个非常非常长的章节标题，用来验证标题是否单行截断并显示省略号',
    children: [
      {
        id: 'c1-1',
        title: '背景与动机',
        children: [
          {
            id: 'c1-1-1',
            title: '国内研究现状与主要问题分析',
            children: [
              { id: 'c1-1-1-1', title: '第四层章节标题仍然保持清晰的层级缩进', children: [] },
            ],
          },
        ],
      },
      { id: 'c1-2', title: '研究方法与实验设计', children: [] },
    ],
  },
  { id: 'c2', title: '第二章 结论', children: [] },
]

export const DeepAndLongTitles: Story = {
  args: { tree: deepAndLong, selectedId: 'c1-1-1' },
}

export const Nested: Story = {
  args: { tree: nested, selectedId: null },
}

export const Selected: Story = {
  args: { tree: nested, selectedId: 'sec-1-2' },
}

/** 节点菜单打开：新建同级章节 / 新建子章节 / 重命名 / 删除。 */
export const MenuOpen: Story = {
  args: { tree: nested, selectedId: null },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('.chapter-tree__more')?.click()
  },
}

/** 内联重命名：编号保留，标题变为输入框。 */
export const InlineRename: Story = {
  args: { tree: nested, selectedId: 'sec-1-1', editingId: 'sec-1-1' },
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

/** 可交互拖拽的渲染：持有一份树状态，把 move 意图交给 Application 执行。 */
function interactive(args: { tree: ChapterTreeModel }) {
  return {
    components: { ChapterTree },
    setup() {
      const tree = ref<ChapterTreeModel>(args.tree)
      const move = (intent: MoveIntent): void => {
        const result = moveChapterTo(tree.value, intent)
        if (result.ok) tree.value = result.tree
      }
      return { tree, move }
    },
    template: '<ChapterTree :tree="tree" @move="move" />',
  }
}

/** 拖动章节行，松手后经 Application 用例真正改变树的位置。 */
export const DragAndDrop: Story = {
  args: { tree: nested, selectedId: null },
  render: (args) => interactive(args),
}

/**
 * 边界情况：可人工验证无效目标与取消行为。
 *
 * - 把「第一部分 基础」拖到它自己的后代（第一章 / 1.1）上：不出现任何反馈，松手无变化。
 * - 把「1.1 环境准备」放到紧邻的「1.2 第一个程序」之前：原位，无反馈、无变化。
 * - 把「1.1 环境准备」放到「1.2 第一个程序」之后：正常插入线，松手后位置改变。
 * - 未进入任何有效目标就松手 / 拖拽取消：所有反馈清除，树不变。
 */
export const DragBoundaries: Story = {
  args: { tree: nested, selectedId: null },
  render: (args) => interactive(args),
}
