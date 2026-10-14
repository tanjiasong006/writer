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

/** 中转站与 GitHub 都失败：每个地址的原因（含内层的 DNS、连接等原因）各占一行。 */
export const FailedViaMirror: Story = {
  args: {
    state: {
      kind: 'failed',
      message: [
        'error sending request for url (https://download.githubcdn.com/?url=https%3A%2F%2Fgithub%2Ecom%2Ftanjiasong006%2Fwriter%2Freleases%2Fdownload%2Fupdater%2Flatest%2Ejson): client error (Connect): tcp connect error: Connection refused (os error 61)',
        'error sending request for url (https://github.com/tanjiasong006/writer/releases/download/updater/latest.json): client error (Connect): dns error: failed to lookup address information: nodename nor servname provided, or not known',
      ].join('\n'),
    },
  },
}

/**
 * 发现新版本，带较长的更新说明（在框内滚动）。说明是发布流水线生成的 Markdown，按标题、列表显示；
 * 标记之后的安装方法与完整变更只在发布页上显示。
 */
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
        '<!-- writer:release-page-only -->',
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

/** 下载中：进度条与已下载大小，“在后台继续”关闭对话框。 */
export const Installing: Story = {
  args: {
    state: { kind: 'installing', version: '0.2.0', downloaded: 12_400_000, total: 28_835_840, direct: false, installing: false },
  },
}

/** 服务器没有给出总大小：不显示进度条，只显示已下载的大小。 */
export const InstallingUnknownSize: Story = {
  args: {
    state: { kind: 'installing', version: '0.2.0', downloaded: 5_300_000, total: null, direct: false, installing: false },
  },
}

/** 经中转站下载失败，改为直接从 GitHub 下载（进度从头开始）。 */
export const InstallingDirect: Story = {
  args: {
    state: { kind: 'installing', version: '0.2.0', downloaded: 2_100_000, total: 28_835_840, direct: true, installing: false },
  },
}

/** 下载完成，正在安装：进度条满，不显示大小。 */
export const InstallingPhase: Story = {
  args: {
    state: { kind: 'installing', version: '0.2.0', downloaded: 28_835_840, total: 28_835_840, direct: false, installing: true },
  },
}

export const Installed: Story = { args: { state: { kind: 'installed', version: '0.2.0' } } }

export const InstallFailed: Story = { args: { state: { kind: 'install-failed', message: 'signature verification failed' } } }
