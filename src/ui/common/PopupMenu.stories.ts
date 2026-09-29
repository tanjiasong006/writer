import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PopupMenu from './PopupMenu.vue'

const meta = {
  title: 'UI/Common/PopupMenu',
  component: PopupMenu,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PopupMenu>

export default meta
type Story = StoryObj<typeof meta>

const items = [
  { id: 'create-sibling', label: '新建同级章节' },
  { id: 'create-child', label: '新建子章节' },
  { separator: true },
  { id: 'up', label: '上移', shortcut: 'Alt+Shift+ArrowUp', disabled: true },
  { id: 'down', label: '下移', shortcut: 'Alt+Shift+ArrowDown' },
  { separator: true },
  { id: 'rename', label: '重命名', shortcut: 'F2' },
  { id: 'delete', label: '删除' },
] as const

/** 在按钮下方打开（右对齐）；指针经过的项高亮，含不可用项、分隔线与快捷键。 */
export const BelowButton: Story = {
  args: { items: [...items], anchor: { rect: { top: 40, bottom: 64, left: 200, right: 224 }, align: 'end' } },
}

/** 由键盘打开：第一项已获得焦点，↑ / ↓ 移动，Esc 关闭。 */
export const KeyboardOpened: Story = {
  args: { ...BelowButton.args!, keyboard: true },
}

/** 右键位置靠近窗口右下角：菜单翻转到指针的左上方，留在窗口内。 */
export const NearWindowEdge: Story = {
  args: { items: [...items], anchor: { x: 10_000, y: 10_000 } },
}
