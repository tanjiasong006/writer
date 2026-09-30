import { expect, test } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import type { MenuEntry } from '../../application/desktop_shell.ts'
import { commandState } from './commands.ts'
import { createEditorState } from './plugins.ts'
import { parseMarkdown } from './markdown.ts'
import { editorContextMenu } from './editor_menu.ts'

function labels(entries: readonly MenuEntry[]): string[] {
  return entries.map((entry) => ('separator' in entry ? '-' : 'role' in entry ? entry.role : entry.label))
}

function stateAt(markdown: string, pos: number) {
  const state = createEditorState(parseMarkdown(markdown))
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

test('正文中：剪切 / 拷贝 / 粘贴、文字格式、段落结构（当前结构打勾）、插入', () => {
  const entries = editorContextMenu(commandState(stateAt('- 列表项\n', 3)), null)
  expect(labels(entries)).toEqual([
    'cut', 'copy', 'paste', '-',
    '粗体', '斜体', '删除线', '行内代码', '-',
    '无序列表', '有序列表', '引用', '代码块', '-',
    '插入表格', '插入图片…',
  ])
  const bullet = entries.find((entry) => 'label' in entry && entry.label === '无序列表')
  expect(bullet && 'checked' in bullet && bullet.checked).toBe(true)
})

test('表格中：行列操作在最前；表头行不能在上方插入行或删除', () => {
  const table = '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n'
  const inHeader = editorContextMenu(commandState(stateAt(table, 3)), null)
  expect(labels(inHeader).slice(0, 8)).toEqual([
    '在上方插入行', '在下方插入行', '在左侧插入列', '在右侧插入列', '-', '删除行', '删除列', '删除表格',
  ])
  const disabled = (entries: readonly MenuEntry[], label: string) =>
    entries.some((entry) => 'label' in entry && entry.label === label && entry.disabled)
  expect(disabled(inHeader, '在上方插入行')).toBe(true)
  expect(disabled(inHeader, '删除行')).toBe(true)
  const inBody = editorContextMenu(commandState(stateAt(table, 12)), null)
  expect(disabled(inBody, '在上方插入行')).toBe(false)
  expect(disabled(inBody, '删除行')).toBe(false)
  expect(labels(inBody)).not.toContain('插入表格')
})

test('选中图片：添加 / 编辑图注、剪切 / 拷贝，没有尺寸或对齐', () => {
  const state = commandState(stateAt('正文', 1))
  expect(labels(editorContextMenu(state, ''))).toEqual(['添加图注', '-', 'cut', 'copy'])
  expect(labels(editorContextMenu(state, '实验装置'))).toEqual(['编辑图注', '-', 'cut', 'copy'])
})
