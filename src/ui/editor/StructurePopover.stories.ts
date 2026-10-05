import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StructurePopover from './StructurePopover.vue'

const meta = {
  title: 'UI/Editor/StructurePopover',
  component: StructurePopover,
  parameters: { layout: 'fullscreen' },
  args: { anchor: { x: 160, y: 120 }, smiles: '' },
} satisfies Meta<typeof StructurePopover>

export default meta
type Story = StoryObj<typeof meta>

/** 插入新结构式：空的输入框。 */
export const New: Story = {}

/** 按名称查找：匹配的分子列在输入框下，默认第一个，预览随之变化。 */
export const Search: Story = {
  play: ({ canvasElement }) => {
    const input = canvasElement.ownerDocument.querySelector<HTMLInputElement>('.structure-popover__search')
    if (!input) return
    input.value = '苯'
    input.dispatchEvent(new Event('input'))
  },
}

/** 编辑已有结构式：输入框中是 SMILES，库中有的显示名称。 */
export const Editing: Story = { args: { smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O' } }

/** 无法识别的 SMILES：预览以红色原文显示。 */
export const Invalid: Story = { args: { smiles: 'C1CC(' } }

/** 反应式：反应物与产物写名称或 SMILES，箭头与上下的条件。 */
export const Reaction: Story = {
  args: { smiles: 'CCO.CC(=O)O>>CCOC(C)=O.O', arrow: '<=>', above: '浓硫酸', below: '△' },
}

/** 反应式中输入名称：下方列出匹配。 */
export const ReactionSuggestions: Story = {
  args: { smiles: 'CCO>>C=C.O', above: '浓硫酸' },
  play: ({ canvasElement }) => {
    const input = canvasElement.ownerDocument.querySelector<HTMLInputElement>('.structure-popover__input')
    if (!input) return
    input.value = '乙醇 + 乙'
    input.dispatchEvent(new Event('input'))
  },
}

