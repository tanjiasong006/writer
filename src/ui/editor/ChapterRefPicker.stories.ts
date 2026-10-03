import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import type { ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import ChapterRefPicker from './ChapterRefPicker.vue'

const tree: ChapterTree = [
  {
    id: 'a',
    title: '绪论',
    children: [
      { id: 'a1', title: '研究背景', children: [{ id: 'a1a', title: '城市更新中的社区公共空间使用与评价研究综述', children: [] }] },
      { id: 'a2', title: '', children: [] },
    ],
  },
  { id: 'b', title: '研究方法', children: [{ id: 'b1', title: '样点选择', children: [] }, { id: 'b2', title: '数据采集', children: [] }] },
  { id: 'c', title: '结果', children: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, title: `第 ${i + 1} 组结果`, children: [] })) },
  { id: 'd', title: '结论', children: [] },
]

const meta = {
  title: 'UI/Editor/ChapterRefPicker',
  component: ChapterRefPicker,
  parameters: { layout: 'fullscreen' },
  /** 在一段正文的光标处弹出；选择或取消后在下方显示结果，点击正文重新打开。 */
  render: (args) => ({
    components: { ChapterRefPicker },
    setup() {
      const open = ref(true)
      const result = ref('')
      return { args, open, result }
    },
    template: `
      <div style="padding: 80px 120px; font-size: 16px; line-height: 1.8" @click="open = true">
        <p>正文中按 ⌘K 插入章节引用：见▏</p>
        <p style="color: var(--color-text-tertiary); font-size: 13px">{{ result }}</p>
        <ChapterRefPicker
          v-if="open"
          v-bind="args"
          @pick="(id, show) => { open = false; result = '选择了 ' + id + '（' + show + '）' }"
          @cancel="open = false; result = '已取消'"
          @click.stop
        />
      </div>`,
  }),
} satisfies Meta<typeof ChapterRefPicker>

export default meta
type Story = StoryObj<typeof meta>

/** 插入新引用：多级章节、未命名章节、长标题，章节较多时列表滚动。 */
export const Insert: Story = {
  args: { tree, anchor: { x: 300, y: 115 } },
}

/** 更改已有引用：预先选中它的目标（滚动到可见）与当前的显示格式。 */
export const Change: Story = {
  args: { tree, anchor: { x: 300, y: 115 }, current: { id: 'c9', show: 'title' } },
}

/** 靠近窗口底部时显示在光标上方。 */
export const NearBottom: Story = {
  args: { tree, anchor: { x: 300, y: 640 } },
}

/** 章节之后列出有编号的图表；选中图表时显示格式不可用。 */
export const WithFiguresAndTables: Story = {
  args: {
    tree,
    anchor: { x: 300, y: 115 },
    elements: [
      { kind: 'figure', id: 'flow', label: '图 1-1', caption: '研究流程', chapterId: 'a', index: 0 },
      { kind: 'table', id: null, label: '表 2-1', caption: '样本构成', chapterId: 'b', index: 0 },
      { kind: 'figure', id: null, label: '图 2-1', caption: '三个城市社区公共空间的使用频率与满意度对比', chapterId: 'b', index: 0 },
    ],
  },
}
