import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { provide } from 'vue'
import App from './App.vue'
import { APP_SERVICES } from './ui/services.ts'
import { createMemoryServices } from './testing/memory_services.ts'
import { sampleDocument } from './testing/sample_document.ts'

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

/** 保存一直失败：修改后按 Cmd/Ctrl+S，状态栏显示失败原因与重试。 */
export const SaveFailing: Story = {
  decorators: [
    withServices((services) => {
      services.storage.seed('/文稿/示例论文', sampleDocument())
      services.shell.lastProjectPath = '/文稿/示例论文'
      const failure = { code: 'io', operation: 'write', path: 'content/ch_1.md', message: '磁盘已满' } as const
      services.storage.save = async () => ({ ok: false, error: failure })
    }),
  ],
}
