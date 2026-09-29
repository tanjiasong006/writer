import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { provide } from 'vue'
import App from './App.vue'
import { APP_SERVICES } from './ui/services.ts'
import { createMemoryServices } from './testing/memory_services.ts'
import { largeDocument, sampleDocument } from './testing/sample_document.ts'
import { createDocument } from './domain/document/document.ts'

/** 每个 story 用独立的内存存储，不依赖 Tauri。 */
function withServices(configure: (services: ReturnType<typeof createMemoryServices>) => void) {
  return () => ({
    setup() {
      const services = createMemoryServices()
      services.shell.newProjectPath = '/文稿/新文档'
      configure(services)
      provide(APP_SERVICES, services)
    },
    template: '<story />',
  })
}

function emptyDocument() {
  const result = createDocument('空文档', [], new Map())
  if (!result.ok) throw new Error('empty document is inconsistent')
  return result.document
}

const meta = {
  title: 'App',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

/** 没有打开项目：欢迎页。「新建文档」会在内存中创建一个空项目。 */
export const Welcome: Story = {
  decorators: [withServices(() => {})],
}

/** 打开示例项目：章节树、保存状态、Cmd/Ctrl+S 保存均可操作。 */
export const OpenProject: Story = {
  decorators: [
    withServices((services) => {
      services.storage.seed('/文稿/示例论文', sampleDocument())
      services.shell.lastProjectPath = '/文稿/示例论文'
    }),
  ],
}

/**
 * macOS 窗口：标题栏与工具栏合为一体。左上角留出窗口按钮的位置（Storybook 中没有真实的窗口按钮），
 * 侧栏开关在侧栏顶部右侧；隐藏侧栏后移到工具栏开头。
 */
export const OpenProjectMac: Story = {
  decorators: [
    withServices((services) => {
      services.shell.windowStyle = 'unified'
      services.storage.seed('/文稿/示例论文', sampleDocument())
      services.shell.lastProjectPath = '/文稿/示例论文'
    }),
  ],
}

/** 保存一直失败：修改后按 Cmd/Ctrl+S，状态栏显示失败原因与重试。 */
export const SaveFailing: Story = {
  decorators: [
    withServices((services) => {
      services.storage.seed('/文稿/示例论文', sampleDocument())
      services.shell.lastProjectPath = '/文稿/示例论文'
      const failure = { code: 'io', operation: 'write', path: 'content/ch_1.md', kind: 'disk-full', message: 'No space left on device' } as const
      services.storage.save = async () => ({ ok: false, error: failure })
    }),
  ],
}

/** 大文档：1050 个章节、每章约 2000 字，用于检查章节树、切换章节、输入与预览的性能。 */
export const LargeDocument: Story = {
  decorators: [
    withServices((services) => {
      services.storage.seed('/文稿/大文档', largeDocument())
      services.shell.lastProjectPath = '/文稿/大文档'
    }),
  ],
}

/** 导出：选择位置后导出，完成后底部出现提示（可"在文件夹中显示"，数秒后自动消失）。 */
export const ExportNotice: Story = {
  decorators: [
    withServices((services) => {
      services.storage.seed('/文稿/示例论文', sampleDocument())
      services.shell.lastProjectPath = '/文稿/示例论文'
      services.shell.exportPath = '/文稿/示例论文.docx'
    }),
  ],
}

/** 空文档：侧栏与正文区都给出新建第一个章节的入口。 */
export const EmptyDocument: Story = {
  decorators: [
    withServices((services) => {
      services.storage.seed('/文稿/空文档', emptyDocument())
      services.shell.lastProjectPath = '/文稿/空文档'
    }),
  ],
}
