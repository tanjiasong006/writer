import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { nextTick, ref } from 'vue'
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
  // 受控组件：story 内用本地状态承接 v-model，模拟真实上层。
  render: (args) => ({
    components: { ChapterManager },
    setup() {
      const tree = ref(args.tree)
      const selectedId = ref(args.selectedId ?? null)
      return { tree, selectedId, hasContent: args.hasContent }
    },
    template:
      '<ChapterManager v-model:tree="tree" v-model:selected-id="selectedId" :has-content="hasContent" />',
  }),
} satisfies Meta<typeof ChapterManager>

export default meta
type Story = StoryObj<typeof meta>

/** 等 Vue 更新 DOM 后再继续，供 play 里连续操作使用。 */
async function clickButton(root: HTMLElement, label: string): Promise<void> {
  const target = Array.from(root.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  target?.click()
  await nextTick()
}

function row(root: HTMLElement, index: number): HTMLElement | undefined {
  return root.querySelectorAll<HTMLElement>('.chapter-tree__row')[index]
}

/** 点击第 index 行的 ··· 打开节点菜单。 */
async function openMenu(root: HTMLElement, index: number): Promise<void> {
  row(root, index)?.querySelector<HTMLElement>('.chapter-tree__more')?.click()
  await nextTick()
}

/** 点击当前打开的菜单中的某一项。 */
async function clickMenu(root: HTMLElement, label: string): Promise<void> {
  const target = Array.from(root.querySelectorAll<HTMLElement>('.chapter-tree__menu button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  target?.click()
  await nextTick()
}

async function doubleClickTitle(root: HTMLElement, index: number): Promise<void> {
  row(root, index)
    ?.querySelector<HTMLElement>('.chapter-tree__label')
    ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await nextTick()
}

/** 空树：显示空状态与「新建第一个章节」。 */
export const Empty: Story = {
  args: { tree: [], selectedId: null },
}

/** 选中章节：选中态、拖拽与节点菜单都可用。 */
export const Selected: Story = {
  args: { tree: nested, selectedId: 'ch-1' },
}

/** Tree Header 的 +：无选中时追加根章节并立即进入内联重命名。 */
export const CreateRoot: Story = {
  args: { tree: nested, selectedId: null },
  play: async ({ canvasElement }) => {
    await clickButton(canvasElement, '+')
  },
}

/** 节点菜单：新建同级章节。 */
export const CreateSibling: Story = {
  args: { tree: nested, selectedId: null },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement, 0)
    await clickMenu(canvasElement, '新建同级章节')
  },
}

/** 节点菜单：新建子章节。 */
export const CreateChild: Story = {
  args: { tree: nested, selectedId: null },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement, 0)
    await clickMenu(canvasElement, '新建子章节')
  },
}

/** 双击标题进入内联重命名。 */
export const RenameInline: Story = {
  args: { tree: nested, selectedId: 'sec-1-1' },
  play: async ({ canvasElement }) => {
    await doubleClickTitle(canvasElement, 1)
  },
}

/** 节点菜单打开状态。 */
export const MenuOpen: Story = {
  args: { tree: nested, selectedId: null },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement, 0)
  },
}

/** 删除确认：含子章节时提示会一并删除。 */
export const DeleteConfirm: Story = {
  args: { tree: nested, selectedId: 'ch-1' },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement, 0)
    await clickMenu(canvasElement, '删除')
  },
}

/** 删除有正文的叶子章节：确认文案说明包含正文。 */
export const DeleteWithContent: Story = {
  args: { tree: nested, selectedId: 'ch-2', hasContent: () => true },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement, 3)
    await clickMenu(canvasElement, '删除')
  },
}

/** 删除空白叶子章节：没有子章节也没有正文，直接删除，不显示确认（ui-spec §23）；焦点落在相邻章节。 */
export const DeleteBlankDirect: Story = {
  args: { tree: nested, selectedId: 'ch-2', hasContent: () => false },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement, 3)
    await clickMenu(canvasElement, '删除')
  },
}

/** 删除取消：确认区关闭，章节与选择保留。 */
export const DeleteCancelled: Story = {
  args: { tree: nested, selectedId: 'ch-1' },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement, 0)
    await clickMenu(canvasElement, '删除')
    await clickButton(canvasElement, '取消')
  },
}

/** 拖拽回归：可拖动章节行，松手后经 Application 更新树。 */
export const DragAndDrop: Story = {
  args: { tree: nested, selectedId: null },
}
