import type { Meta, StoryObj } from '@storybook/vue3-vite'
import UpdateDialog from './UpdateDialog.vue'

const meta = {
  title: 'UI/AppShell/UpdateDialog',
  component: UpdateDialog,
  parameters: { layout: 'fullscreen' },
  args: { appName: 'Writer', state: { kind: 'checking' } },
} satisfies Meta<typeof UpdateDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Checking: Story = {}

export const UpToDate: Story = { args: { state: { kind: 'up-to-date', current: '0.1.0' } } }

export const NotConfigured: Story = { args: { state: { kind: 'not-configured' } } }

export const Failed: Story = {
  args: { state: { kind: 'failed', message: 'error sending request for url (https://example.com/latest.json)' } },
}

/** 发现新版本，带较长的更新说明（在框内滚动）。说明是发布流水线生成的 Markdown，按标题、列表显示。 */
export const Available: Story = {
  args: {
    state: {
      kind: 'available',
      current: '0.1.0',
      version: '0.2.0',
      notes: [
        '### 新功能',
        '',
        '- 查找与替换：当前章节与全文',
        '- 删除章节后可以撤销',
        '- 粘贴与拖入图片自动导入项目',
        '',
        '### 修复',
        '',
        '- 导出 Word 时图片丢失',
        '',
        '### 安装',
        '',
        '- **macOS**（Apple Silicon 与 Intel 通用）：下载 `.dmg`，把 Writer 拖进“应用程序”。',
        '- **Windows**：下载 `-setup.exe`（推荐）或 `.msi` 安装。',
        '',
        '完整变更：https://github.com/tanjiasong006/writer/compare/v0.1.0...v0.2.0',
      ].join('\n'),
    },
  },
}

export const Installing: Story = { args: { state: { kind: 'installing', version: '0.2.0' } } }

export const Installed: Story = { args: { state: { kind: 'installed', version: '0.2.0' } } }

export const InstallFailed: Story = { args: { state: { kind: 'install-failed', message: 'signature verification failed' } } }
