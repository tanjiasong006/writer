import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SaveStatus from './SaveStatus.vue'

const meta = {
  title: 'UI/AppShell/SaveStatus',
  component: SaveStatus,
  tags: ['autodocs'],
} satisfies Meta<typeof SaveStatus>

export default meta
type Story = StoryObj<typeof meta>

export const Saved: Story = { args: { status: 'saved', error: null } }
export const Dirty: Story = { args: { status: 'dirty', error: null } }
export const Saving: Story = { args: { status: 'saving', error: null } }
export const Failed: Story = {
  args: {
    status: 'failed',
    error: { code: 'io', operation: 'write', path: 'content/ch_1.md', kind: 'disk-full', message: 'No space left on device' },
  },
}
