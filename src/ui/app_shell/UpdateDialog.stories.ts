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

/** 发现新版本，带较长的更新说明（在框内滚动）。 */
export const Available: Story = {
  args: {
    state: {
      kind: 'available',
      current: '0.1.0',
      version: '0.2.0',
      notes: '- 查找与替换：当前章节与全文\n- 删除章节后可以撤销\n- 字数统计\n- 粘贴与拖入图片自动导入项目\n- 检查更新\n- 修复若干问题',
    },
  },
}

export const Installing: Story = { args: { state: { kind: 'installing', version: '0.2.0' } } }

export const Installed: Story = { args: { state: { kind: 'installed', version: '0.2.0' } } }

export const InstallFailed: Story = { args: { state: { kind: 'install-failed', message: 'signature verification failed' } } }
