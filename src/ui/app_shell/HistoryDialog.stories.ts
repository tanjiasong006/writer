import type { Meta, StoryObj } from '@storybook/vue3-vite'
import HistoryDialog from './HistoryDialog.vue'

const day = 24 * 60 * 60 * 1000
const base = Date.UTC(2026, 9, 3, 2, 30)

const meta = {
  title: 'UI/AppShell/HistoryDialog',
  component: HistoryDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    snapshots: [
      { id: '4', createdAt: base, label: '', kind: 'before-restore', title: '论文', chapters: 12, characters: 38210 },
      { id: '3', createdAt: base - day, label: '交给导师的版本', kind: 'manual', title: '论文', chapters: 12, characters: 36880 },
      { id: '2', createdAt: base - 2 * day, label: '', kind: 'auto', title: '论文', chapters: 11, characters: 30102 },
      { id: '1', createdAt: base - 9 * day, label: '初稿', kind: 'manual', title: '论文', chapters: 8, characters: 12044 },
    ],
  },
} satisfies Meta<typeof HistoryDialog>

export default meta
type Story = StoryObj<typeof meta>

export const List: Story = {}

export const Empty: Story = { args: { snapshots: [] } }

export const Loading: Story = { args: { snapshots: null } }
