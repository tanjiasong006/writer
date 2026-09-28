import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import ChapterEditor from './ChapterEditor.vue'
import { THEMES, setImageLayout, defaultDocumentStyle, type ImageLayouts, type ImageOverride } from '../../domain/document_style/document_style.ts'

const meta = {
  title: 'UI/Editor/ChapterEditor',
  component: ChapterEditor,
  parameters: { layout: 'fullscreen' },
  // 模拟上层：把 change 写回 content、把 image-layout 写回图片布局，行为与工作区一致。
  render: (args) => ({
    components: { ChapterEditor },
    setup() {
      const content = ref(args.content)
      const layouts = ref<ImageLayouts>(args.imageLayouts ?? new Map())
      return {
        args,
        content,
        layouts,
        update: (_id: string, text: string) => (content.value = text),
        setLayout: (key: string, layout: ImageOverride | null) => {
          layouts.value = setImageLayout({ ...defaultDocumentStyle(), images: layouts.value }, key, layout).images
        },
      }
    },
    template:
      '<div style="height: 100vh"><ChapterEditor v-bind="args" :content="content" :image-layouts="layouts" @change="update" @image-layout="setLayout" /></div>',
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

const svgImage = (label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200"><rect width="480" height="200" fill="#e5e7eb"/><text x="240" y="108" font-size="20" text-anchor="middle" fill="#374151">${label}</text></svg>`,
  )}`

/**
 * 图片：项目内的图片正常显示（这里用内嵌 SVG 模拟），无法显示的引用显示占位。
 * 点击选中图片后出现布局按钮（原始 / 小 / 中 / 大 / 通栏，靠左 / 居中 / 靠右），Cmd+Z 可撤销。
 */
export const Images: Story = {
  args: {
    chapterId: 'ch-4',
    number: '2.2',
    title: '实验装置',
    content: '装置示意：\n\n![装置](../assets/装置.svg)\n\n![曲线](../assets/曲线.svg)\n\n![缺失的图](../assets/缺失.png)\n',
    imageLayouts: new Map([['assets/曲线.svg', { size: 'small', align: 'left' }]]),
    resolveImage: (reference: string) =>
      reference.endsWith('装置.svg') ? svgImage('实验装置') : reference.endsWith('曲线.svg') ? svgImage('曲线（小图靠左）') : null,
  },
}

/** 技术文档主题：黑体正文、较小字号；图片默认为正文宽度的 85%。 */
export const TechnicalTheme: Story = {
  args: {
    chapterId: 'ch-5',
    number: '1',
    title: '系统架构',
    theme: THEMES.technical,
    content: '## 模块\n\n系统分为**存储**与*渲染*两部分。\n\n![架构](../assets/架构.svg)\n\n> 设计原则：简单可靠。\n\n| 模块 | 职责 |\n| --- | --- |\n| 存储 | 保存事务 |\n',
    resolveImage: () => svgImage('架构图'),
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
