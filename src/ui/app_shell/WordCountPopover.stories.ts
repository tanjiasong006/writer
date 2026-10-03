import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WordCountPopover from './WordCountPopover.vue'

const meta = {
  title: 'UI/AppShell/WordCountPopover',
  component: WordCountPopover,
  parameters: { layout: 'fullscreen' },
  args: {
    anchor: { right: 24, bottom: 40 },
    selection: null,
    chapter: { words: 3256, characters: 3410 },
    document: { words: 128904, characters: 131877 },
  },
} satisfies Meta<typeof WordCountPopover>

export default meta
type Story = StoryObj<typeof meta>

/** 没有选中内容：本章与全文。 */
export const ChapterAndDocument: Story = {}

/** 有选中内容时多一行。 */
export const WithSelection: Story = { args: { selection: { words: 56, characters: 61 } } }

/** 空章节。 */
export const EmptyChapter: Story = { args: { chapter: { words: 0, characters: 0 }, document: { words: 0, characters: 0 } } }
