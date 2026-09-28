import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import ChapterTree from './ChapterTree.vue'
import type { ChapterId, ChapterTree as ChapterTreeModel } from '../../domain/chapter_tree/chapter_tree.ts'
import {
  appendChapter,
  createChapterAfter,
  type CreateChapterResult,
} from '../../application/create_chapter.ts'
import { moveChapterTo, type MoveIntent } from '../../application/move_chapter.ts'
import { renameChapter } from '../../application/rename_chapter.ts'
import { removeChapter } from '../../application/remove_chapter.ts'

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
  // ChapterTree 只发意图、不改树，Story 里补一个最小宿主，菜单/重命名/新建才可见地生效。
  render: (args) => interactive(args),
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

/** 新建章节的默认标题，与 ChapterManager 保持一致。 */
const NEW_CHAPTER_TITLE = '未命名章节'

/** 只关心树结果的 Application 返回值（rename / remove / move）。 */
type TreeResult =
  | { readonly ok: true; readonly tree: ChapterTreeModel }
  | { readonly ok: false }

/**
 * 可交互渲染：Story 作为最小宿主，持有 tree / selectedId / editingId，
 * 把 ChapterTree 发出的意图交给 Application 用例执行。
 * 只用于让菜单、内联重命名、新建、拖拽在 Storybook 里可见地生效，
 * 真正的组合与错误文案属于 ChapterManager。
 */
function interactive(args: {
  tree: ChapterTreeModel
  selectedId?: ChapterId | null
  editingId?: ChapterId | null
}) {
  return {
    components: { ChapterTree },
    setup() {
      const tree = ref<ChapterTreeModel>(args.tree)
      const selectedId = ref<ChapterId | null>(args.selectedId ?? null)
      const editingId = ref<ChapterId | null>(args.editingId ?? null)

      const applyTree = (result: TreeResult): void => {
        if (result.ok) tree.value = result.tree
      }
      const applyCreate = (result: CreateChapterResult): void => {
        if (!result.ok) return
        tree.value = result.tree
        selectedId.value = result.chapterId
        editingId.value = result.chapterId
      }
      const select = (id: ChapterId): void => {
        selectedId.value = id
        editingId.value = null
      }

      return {
        tree,
        selectedId,
        editingId,
        select,
        move: (intent: MoveIntent) => applyTree(moveChapterTo(tree.value, intent)),
        createRoot: () =>
          applyCreate(
            selectedId.value === null
              ? appendChapter(tree.value, null, NEW_CHAPTER_TITLE)
              : createChapterAfter(tree.value, selectedId.value, NEW_CHAPTER_TITLE),
          ),
        createSibling: (id: ChapterId) =>
          applyCreate(createChapterAfter(tree.value, id, NEW_CHAPTER_TITLE)),
        createChild: (id: ChapterId) => applyCreate(appendChapter(tree.value, id, NEW_CHAPTER_TITLE)),
        startRename: (id: ChapterId) => {
          editingId.value = id
        },
        rename: (id: ChapterId, title: string) => {
          editingId.value = null
          applyTree(renameChapter(tree.value, id, title))
        },
        cancelRename: () => {
          editingId.value = null
        },
        remove: (id: ChapterId) => {
          applyTree(removeChapter(tree.value, id))
          if (selectedId.value === id) selectedId.value = null
        },
      }
    },
    template: `
      <ChapterTree
        :tree="tree"
        :selected-id="selectedId"
        :editing-id="editingId"
        @select="select"
        @move="move"
        @create-root="createRoot"
        @create-sibling="createSibling"
        @create-child="createChild"
        @start-rename="startRename"
        @rename="rename"
        @cancel-rename="cancelRename"
        @delete="remove"
      />
    `,
  }
}

/** 拖动章节行，松手后经 Application 用例真正改变树的位置。 */
export const DragAndDrop: Story = {
  args: { tree: nested, selectedId: null },
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
}

/**
 * 键盘导航与键盘移动（ui-spec §29）：焦点已在「1.1 环境准备」，可直接按键验证。
 *
 * - ↑ / ↓ / Home / End：选择上一 / 下一 / 第一 / 最后一个可见章节。
 * - → / ←：展开 / 进入子章节；折叠 / 回到父章节。
 * - Alt+Shift+↑ / ↓：同级上移 / 下移；Alt+Shift+← / →：提升 / 降级；焦点跟随被移动的章节。
 * - F2 重命名；Delete 不删除章节。Tab 只停在当前行（整行蓝色描边为键盘焦点）。
 */
export const KeyboardNavigation: Story = {
  args: { tree: nested, selectedId: 'sec-1-1' },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('.chapter-tree__label[data-chapter-id="sec-1-1"]')?.focus()
  },
}
