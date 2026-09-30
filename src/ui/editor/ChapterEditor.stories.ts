import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import ChapterEditor from './ChapterEditor.vue'

const meta = {
  title: 'UI/Editor/ChapterEditor',
  component: ChapterEditor,
  parameters: { layout: 'fullscreen' },
  // 模拟上层：把 change 写回 content，行为与工作区一致。
  render: (args) => ({
    components: { ChapterEditor },
    setup() {
      const content = ref(args.content)
      return { args, content, update: (_id: string, text: string) => (content.value = text) }
    },
    template: '<div style="height: 100vh"><ChapterEditor v-bind="args" :content="content" @change="update" /></div>',
  }),
} satisfies Meta<typeof ChapterEditor>

export default meta
type Story = StoryObj<typeof meta>

/** 常见结构：标题、强调、列表（含嵌套与任务列表）、引用、表格、代码、分隔线。 */
export const Markdown: Story = {
  args: {
    chapterId: 'ch-1',
    number: '2.1',
    title: '实验设计',
    content: [
      '本节介绍**实验设计**与*变量控制*。',
      '',
      '## 样本',
      '',
      '- 对照组',
      '- 实验组',
      '  - 子组 A',
      '',
      '1. 招募',
      '2. 分组',
      '',
      '- [x] 伦理审批',
      '- [ ] 数据采集',
      '',
      '> 所有数据均经过脱敏处理。',
      '',
      '| 组别 | 样本数 |',
      '| --- | ---: |',
      '| 对照组 | 30 |',
      '| **实验组** | 32 |',
      '',
      '---',
      '',
      '行内 `代码`、~~删除线~~ 与[链接](https://example.com)。',
      '',
      '```python',
      'print("hello")',
      '```',
      '',
    ].join('\n'),
  },
}

const svgImage = (label: string, width = 480, height = 200) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#e5e7eb"/><text x="${width / 2}" y="${height / 2 + 8}" font-size="20" text-anchor="middle" fill="#374151">${label}</text></svg>`,
  )}`

/**
 * 图片：项目内的图片正常显示（这里用内嵌 SVG 模拟），无法显示的引用显示占位。
 * 图片按统一规则显示：独占一段的图片居中、保持比例、不放大、不超过正文宽度；没有单张图片的尺寸或对齐设置。
 * 点击选中图片后只有选中框；Delete 删除、Cmd+Z 撤销。
 * 独占一段的图片是一个整体：光标不会停在图片旁边；↑ / ↓ 进出图片，最后一张图片之后按 ↓ 即可继续写。
 */
export const Images: Story = {
  args: {
    chapterId: 'ch-4',
    number: '2.2',
    title: '实验装置',
    content: '装置示意：\n\n![装置](../assets/装置.svg)\n\n![曲线](../assets/曲线.svg)\n\n![缺失的图](../assets/缺失.png)\n',
    resolveImage: (reference: string) =>
      reference.endsWith('装置.svg')
        ? svgImage('实验装置')
        : reference.endsWith('曲线.svg')
          ? svgImage('小图（不放大）', 200, 120)
          : null,
  },
}

/**
 * 宽图、竖长图与表格单元格中的图片：宽图缩到正文宽度；竖长图与行内长图受统一的展示高度上限约束，
 * 保持比例、不裁切，不会无限撑高正文区；单元格中的图片不超过单元格宽度。
 */
export const TallAndWideImages: Story = {
  args: {
    chapterId: 'ch-5',
    number: '1',
    title: '图片展示规则',
    content:
      '![宽图](../assets/宽.svg)\n\n![竖长图](../assets/竖.svg)\n\n| 图 | 说明 |\n| --- | --- |\n| ![长图](../assets/竖.svg) | 单元格中的长图 |\n',
    resolveImage: (reference: string) =>
      reference.endsWith('宽.svg') ? svgImage('宽图', 1600, 300) : svgImage('竖长图', 300, 1600),
  },
}

/** 空章节：显示占位提示。 */
export const Empty: Story = {
  args: { chapterId: 'ch-2', number: '3', title: '结论', content: '' },
}

/** 很长的章节：编辑器自身滚动。 */
export const Long: Story = {
  args: {
    chapterId: 'ch-3',
    number: '4',
    title: '长章节',
    content: Array.from({ length: 200 }, (_, i) => `第 ${i + 1} 段：长文档需要稳定的滚动与输入体验。`).join('\n\n'),
  },
}
