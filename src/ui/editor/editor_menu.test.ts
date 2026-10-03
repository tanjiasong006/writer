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
    '列表', '引用', '代码块', '-',
    '插入表格', '插入图片…', '插入章节引用…', '插入脚注…',
  ])
  expect(labels(submenuOf(entries, '列表'))).toEqual(['无序列表', '有序列表', '任务列表'])
  const bullet = submenuOf(entries, '列表').find((entry) => 'label' in entry && entry.label === '无序列表')
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

function submenuOf(entries: readonly MenuEntry[], label: string): readonly MenuEntry[] {
  const entry = entries.find((item) => 'label' in item && item.label === label)
  if (!entry || !('submenu' in entry) || !entry.submenu) throw new Error(`submenu ${label} not found`)
  return entry.submenu
}

function checkedLabels(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((entry) => ('checked' in entry && entry.checked ? [entry.label] : []))
}

test('代码块中：“代码语言”子菜单在最前，当前语言打勾（别名视为相同）', () => {
  const state = commandState(stateAt('```\nx\n```\n', 1))
  expect(labels(editorContextMenu(state, null, '')).slice(0, 2)).toEqual(['代码语言', '-'])
  expect(checkedLabels(submenuOf(editorContextMenu(state, null, ''), '代码语言'))).toEqual(['自动识别'])
  expect(checkedLabels(submenuOf(editorContextMenu(state, null, 'py'), '代码语言'))).toEqual(['Python'])
  expect(checkedLabels(submenuOf(editorContextMenu(state, null, 'sh'), '代码语言'))).toEqual(['Shell'])
})

test('手写的其他语言名列在自动识别之后并打勾', () => {
  const submenu = submenuOf(editorContextMenu(commandState(stateAt('```\nx\n```\n', 1)), null, 'mermaid'), '代码语言')
  expect(labels(submenu).slice(0, 3)).toEqual(['自动识别', 'mermaid', '-'])
  expect(checkedLabels(submenu)).toEqual(['mermaid'])
})

test('不在代码块中没有代码语言菜单', () => {
  expect(labels(editorContextMenu(commandState(stateAt('正文\n', 1)), null))).not.toContain('代码语言')
})

test('选中的章节引用：前往、显示格式（当前格式打勾）、更改目标；失效时不能前往', () => {
  const state = commandState(stateAt('见[2.1](writer:chapter/a?show=number)\n', 1))
  const entries = editorContextMenu(state, null, null, { name: '2.1 方法', show: 'number' })
  expect(labels(entries)).toEqual(['前往“2.1 方法”', '显示格式', '更改目标…', '-', 'cut', 'copy'])
  const formats = submenuOf(entries, '显示格式')
  expect(formats.map((entry) => 'checked' in entry && entry.checked)).toEqual([false, true, false])

  const broken = editorContextMenu(state, null, null, { name: null, show: null })
  expect(broken[0]).toMatchObject({ label: '前往（引用已失效）', disabled: true })
  expect(submenuOf(broken, '显示格式').every((entry) => 'disabled' in entry && entry.disabled)).toBe(true)
})
