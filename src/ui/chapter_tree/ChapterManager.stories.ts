import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { nextTick } from 'vue'
import ChapterManager from './ChapterManager.vue'
import type { ChapterTree as ChapterTreeModel } from '../../domain/chapter_tree/chapter_tree.ts'

const nested: ChapterTreeModel = [
  {
    id: 'ch-1',
    title: '第一章 起步',
    children: [
      { id: 'sec-1-1', title: '1.1 环境准备', children: [] },
      { id: 'sec-1-2', title: '1.2 第一个程序', children: [] },
    ],
  },
  { id: 'ch-2', title: '第二章 进阶', children: [] },
]

const meta = {
  title: 'UI/ChapterManager',
  component: ChapterManager,
  tags: ['autodocs'],
} satisfies Meta<typeof ChapterManager>

export default meta
type Story = StoryObj<typeof meta>

/** 等 Vue 更新 DOM 后再继续，供 play 里连续点击使用。 */
async function clickButton(root: HTMLElement, label: string): Promise<void> {
  const target = Array.from(root.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  target?.click()
  await nextTick()
}

async function clickToggle(root: HTMLElement, index: number): Promise<void> {
  root.querySelectorAll<HTMLElement>('.chapter-tree__toggle')[index]?.click()
  await nextTick()
}

/** 空树：只有工具栏，依赖选择的按钮全部禁用。 */
export const Empty: Story = {
  args: { initialTree: [], initialSelectedId: null },
}

/** 选中章节：选择、折叠、拖拽与 CRUD 按钮都可用。 */
export const Selected: Story = {
  args: { initialTree: nested, initialSelectedId: 'ch-1' },
}

/** 新增根章节：打开内联表单。 */
export const CreateRoot: Story = {
  args: { initialTree: nested, initialSelectedId: null },
  play: async ({ canvasElement }) => {
    await clickButton(canvasElement, '新建根章节')
  },
}

/** 新增子章节：选中章节后打开内联表单。 */
export const CreateChild: Story = {
  args: { initialTree: nested, initialSelectedId: 'ch-1' },
  play: async ({ canvasElement }) => {
    await clickButton(canvasElement, '新建子章节')
  },
}

/** 重命名：表单预填当前标题。 */
export const Rename: Story = {
  args: { initialTree: nested, initialSelectedId: 'sec-1-1' },
  play: async ({ canvasElement }) => {
    await clickButton(canvasElement, '重命名')
  },
}

/** 在已折叠的父章节下新增子章节：父节点自动展开，新章节可见并被选中。 */
export const CreateChildInCollapsedParent: Story = {
  args: { initialTree: nested, initialSelectedId: 'ch-1' },
  play: async ({ canvasElement }) => {
    await clickToggle(canvasElement, 0) // 折叠 ch-1
    await clickButton(canvasElement, '新建子章节')
    const input = canvasElement.querySelector<HTMLInputElement>('#chapter-manager-title')
    if (input) {
      input.value = '新子章节'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await nextTick()
    await clickButton(canvasElement, '确定')
  },
}

/** 删除确认：删除整棵子树前先显示确认区。 */
export const DeleteConfirm: Story = {
  args: { initialTree: nested, initialSelectedId: 'ch-1' },
  play: async ({ canvasElement }) => {
    await clickButton(canvasElement, '删除')
  },
}

/** 删除取消：确认区关闭，章节与选择保留。 */
export const DeleteCancelled: Story = {
  args: { initialTree: nested, initialSelectedId: 'ch-1' },
  play: async ({ canvasElement }) => {
    await clickButton(canvasElement, '删除')
    await clickButton(canvasElement, '取消')
  },
}

/** 失败状态：选择已失效时删除，UI 映射机器码为中文提示。 */
export const DeleteFailure: Story = {
  args: { initialTree: nested, initialSelectedId: 'missing' },
  play: async ({ canvasElement }) => {
    await clickButton(canvasElement, '删除')
    await clickButton(canvasElement, '确认删除')
  },
}

/** 拖拽回归：可拖动章节行，松手后经 Application 更新树。 */
export const DragAndDrop: Story = {
  args: { initialTree: nested, initialSelectedId: null },
}
