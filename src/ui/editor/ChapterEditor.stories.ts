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
    template:
      '<div style="height: 100vh"><ChapterEditor v-bind="args" :content="content" @change="update" /></div>',
  }),
} satisfies Meta<typeof ChapterEditor>

export default meta
type Story = StoryObj<typeof meta>

/** 常见 Markdown 内容：标题、强调、列表、引用、表格、代码。 */
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
      '',
      '> 所有数据均经过脱敏处理。',
      '',
      '| 组别 | 样本数 |',
      '| --- | --- |',
      '| 对照组 | 30 |',
      '',
      '```python',
      'print("hello")',
      '```',
      '',
    ].join('\n'),
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
