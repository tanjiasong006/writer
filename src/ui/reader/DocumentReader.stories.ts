import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import DocumentReader from './DocumentReader.vue'

const svgImage = (label: string, width = 480, height = 200) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#e5e7eb"/><text x="${width / 2}" y="${height / 2 + 8}" font-size="20" text-anchor="middle" fill="#374151">${label}</text></svg>`,
  )}`

const meta = {
  title: 'UI/Reader/DocumentReader',
  component: DocumentReader,
  parameters: { layout: 'fullscreen' },
  /**
   * 模拟工作区：左侧是一列章节（代替章节树），点选后阅读区滚动到该章节；
   * 阅读区滚动时当前章节随之高亮。Esc / Enter 结束阅读的位置显示在列表下方。
   */
  render: (args) => ({
    components: { DocumentReader },
    setup() {
      const active = ref<ChapterId | null>(args.activeChapterId)
      const exited = ref('')
      const rows: Array<{ id: ChapterId; label: string; depth: number }> = []
      const visit = (tree: ChapterTree, depth: number) => {
        for (const node of tree) {
          rows.push({ id: node.id, label: node.title || '未命名章节', depth })
          visit(node.children, depth + 1)
        }
      }
      visit(args.tree, 0)
      return { args, active, exited, rows }
    },
    template: `
      <div style="display: flex; height: 100vh">
        <nav style="width: 200px; overflow-y: auto; padding: 12px 8px; border-right: 1px solid var(--color-separator); background: var(--color-bg-sidebar); font-size: 13px">
          <div
            v-for="row in rows"
            :key="row.id"
            :style="{ padding: '4px 8px', paddingLeft: 8 + row.depth * 14 + 'px', borderRadius: '6px', cursor: 'default', background: row.id === active ? 'var(--color-fill-pressed)' : 'none' }"
            @click="active = row.id"
          >{{ row.label }}</div>
          <p style="margin: 12px 8px; color: var(--color-text-tertiary)">{{ exited }}</p>
        </nav>
        <DocumentReader
          v-bind="args"
          style="flex: 1; height: auto"
          :active-chapter-id="active"
          @select="active = $event"
          @exit="exited = $event ? '结束于 ' + $event.chapterId + ' 第 ' + $event.block + ' 块' : '结束'"
        />
      </div>`,
  }),
} satisfies Meta<typeof DocumentReader>

export default meta
type Story = StoryObj<typeof meta>

const tree: ChapterTree = [
  {
    id: 'a',
    title: '绪论',
    children: [
      { id: 'a1', title: '研究背景', children: [{ id: 'a1a', title: '城市更新中的社区公共空间', children: [] }] },
      { id: 'a2', title: '', children: [] },
    ],
  },
  { id: 'b', title: '研究方法', children: [] },
  { id: 'c', title: '结论', children: [] },
]

const contents = new Map<ChapterId, string>([
  [
    'a',
    '本研究关注**长文档写作**中的结构组织与连续阅读。全文按章节组织，每一章的编号由结构自动生成。\n\n' +
      '- 章节组织\n- 自动编号\n  - 多级编号\n\n> 人们在哪里停留、停留多久，比空间被设计成什么样子更能说明它的质量。\n',
  ],
  [
    'a1',
    '研究以上海市徐汇区、杨浦区的12个社区公共空间为对象，于2025年4月至9月间开展实地调查。\n\n' +
      '| 样点 | 所在区 | 有效问卷 |\n| --- | --- | ---: |\n| 徐家汇公园北入口 | 徐汇 | 142 |\n| 殷行路社区广场 | 杨浦 | 118 |\n',
  ],
  ['a1a', '![图 1-1　样点分布](../assets/分布.svg)\n\n![缺失的图](../assets/缺失.png)\n\n行内图片 ![小图](../assets/小.svg) 与文字同处一行。\n'],
  ['a2', ''],
  [
    'b',
    '定量部分使用Python完成清洗与统计，缺失项超过30%的问卷直接剔除，完整的编码手册见[附录B](https://example.com)。\n\n' +
      '```python\ndf = df[df.isna().mean(axis=1) <= 0.3]\n```\n\n- [x] 核对问卷编号\n- [ ] 补充访谈记录\n\n---\n\n## 正文中的 Markdown 标题是普通文字\n',
  ],
  ['c', '全文完。\n'],
])

const resolveImage = (reference: string) =>
  reference.endsWith('分布.svg') ? svgImage('样点分布') : reference.endsWith('小.svg') ? svgImage('小图', 60, 24) : null

/** 多级章节、未命名章节、空章节，以及各种正文结构与图片（样式与编辑器完全相同）。 */
export const Default: Story = {
  args: { tree, contents, activeChapterId: 'a', resolveImage },
}

/** 打开时停在某一章中间的块（从编辑器进入时，眼前的文字停在原处）。 */
export const OpenAtPosition: Story = {
  args: { tree, contents, activeChapterId: 'b', resolveImage, initialPosition: { chapterId: 'b', block: 1, offset: 120 } },
}

const LONG_CHAPTERS = 300
const longTree: ChapterTree = Array.from({ length: LONG_CHAPTERS / 10 }, (_, part) => ({
  id: `p${part}`,
  title: `第 ${part + 1} 部分`,
  children: Array.from({ length: 9 }, (_, index) => ({ id: `p${part}-${index}`, title: `小节 ${index + 1}`, children: [] })),
}))
const paragraph = '长文档需要稳定的滚动与阅读体验，章节树随阅读位置更新，回到编辑时停在读到的地方。'.repeat(6)
const longContents = new Map<ChapterId, string>(
  longTree.flatMap((part) => [part, ...part.children]).map((node) => [
    node.id,
    Array.from({ length: 30 }, (_, index) => `（${index + 1}）${paragraph}`).join('\n\n'),
  ]),
)

/** 大文档（300 章、约 240 万字）：检查打开速度与快速滚动时当前章节的更新。 */
export const LargeDocument: Story = {
  args: { tree: longTree, contents: longContents, activeChapterId: 'p0' },
}
