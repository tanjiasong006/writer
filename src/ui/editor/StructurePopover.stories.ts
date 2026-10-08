import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StructurePopover from './StructurePopover.vue'
import { loadExtendedMolecules } from './structure_library.ts'

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

/** 扩展库中的分子：排在核心库之后，名称后标“扩展”；带立体构型的大分子在预览中缩小显示。 */
export const ExtendedSearch: Story = {
  play: async ({ canvasElement }) => {
    await loadExtendedMolecules()
    const input = canvasElement.ownerDocument.querySelector<HTMLInputElement>('.structure-popover__search')
    if (!input) return
    input.value = '霉素'
    input.dispatchEvent(new Event('input'))
  },
}

/** 按拼音首字母查找：“yxa”找到乙酰胺（核心库）以及扩展库中的同首字母分子。 */
export const PinyinInitials: Story = {
  play: async ({ canvasElement }) => {
    await loadExtendedMolecules()
    const input = canvasElement.ownerDocument.querySelector<HTMLInputElement>('.structure-popover__search')
    if (!input) return
    input.value = 'yxa'
    input.dispatchEvent(new Event('input'))
  },
}

/** 插入新结构式：没有输入时列出本文档中用过的分子（库外的显示 SMILES），不默认选中。 */
export const UsedInDocument: Story = {
  args: { used: ['CC(C)CC1=CC=C(C=C1)C(C)C(=O)O', 'CCO.CC(=O)O>>CCOC(C)=O.O', 'ClCCCCCCCCCCN'] },
}

/** 选中一个匹配：行末提示 Tab 把它的 SMILES 填入输入框修改。 */
export const SearchSelected: Story = {
  play: ({ canvasElement }) => {
    const input = canvasElement.ownerDocument.querySelector<HTMLInputElement>('.structure-popover__search')
    if (!input) return
    input.value = '苯酚'
    input.dispatchEvent(new Event('input'))
  },
}

/** 编辑已有结构式：输入框中是 SMILES，库中有的显示名称。 */
export const Editing: Story = { args: { smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O' } }

/** 无法识别的 SMILES：预览中标出出错的字符并说明原因。 */
export const Invalid: Story = { args: { smiles: 'C1CC(' } }

/** 不能出现的字符。 */
export const InvalidCharacter: Story = { args: { smiles: 'CC(=O)Oq' } }

/** 分子库中没有的名称：提示可以直接输入 SMILES。 */
export const UnknownName: Story = {
  play: ({ canvasElement }) => {
    const input = canvasElement.ownerDocument.querySelector<HTMLInputElement>('.structure-popover__search')
    if (!input) return
    input.value = '布洛芬片'
    input.dispatchEvent(new Event('input'))
  },
}

/** 旋转、翻转过的分子：预览右上角是方向按钮。 */
export const Oriented: Story = { args: { smiles: 'OCC1=CC=CC=C1', rotate: [90], flip: [true] } }

/** 反应式中分别调整每个分子的方向：点击预览中的分子选中它（这里乙酸已旋转、翻转）。 */
export const ReactionOriented: Story = {
  args: { smiles: 'CCO.CC(=O)O>>CCOC(C)=O.O', arrow: '<=>', above: '浓硫酸', rotate: [0, 90], flip: [false, true] },
}

/** 反应式：反应物与产物写名称或 SMILES，箭头与上下的条件。 */
export const Reaction: Story = {
  args: { smiles: 'CCO.CC(=O)O>>CCOC(C)=O.O', arrow: '<=>', above: '浓硫酸', below: '△' },
}

/** 反应式中输入名称：下方列出匹配，选中的一行末尾是“编辑 SMILES”。 */
export const ReactionSuggestions: Story = {
  args: { smiles: 'CCO>>C=C.O', above: '浓硫酸' },
  play: ({ canvasElement }) => {
    const input = canvasElement.ownerDocument.querySelector<HTMLInputElement>('.structure-popover__input')
    if (!input) return
    input.focus()
    input.value = '乙醇 + 乙'
    input.dispatchEvent(new Event('input'))
  },
}

