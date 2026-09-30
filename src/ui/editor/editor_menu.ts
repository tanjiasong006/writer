import type { MenuEntry } from '../../application/desktop_shell.ts'
import type { CommandState, EditorCommand } from './commands.ts'
import { SHORTCUTS } from '../common/shortcuts.ts'

/**
 * 正文的右键菜单：只列出与点击处直接相关的操作。
 *
 * - 选中的图片：添加 / 编辑图注、剪切 / 拷贝（图片没有单独的尺寸或对齐设置）。
 * - 表格中：插入 / 删除行与列、删除表格，放在最前面。
 * - 其余：剪切 / 拷贝 / 粘贴、文字格式、段落结构（当前所在结构打勾）、插入表格与图片。
 *
 * 菜单项 id：`command:<EditorCommand>`；编辑图注是 `figure:caption`。
 * 快捷键与菜单栏一致，只作显示（右键菜单打开期间才生效）。
 */

/** 编辑命令在菜单中的名称与快捷键（菜单栏与右键菜单共用；快捷键来自 common/shortcuts.ts）。 */
export const COMMAND_LABELS: Readonly<Record<EditorCommand, { readonly label: string; readonly shortcut?: string }>> = {
  undo: { label: '撤销', shortcut: SHORTCUTS.undo },
  // 重做没有"⌘ + 单键"的自然选择（⇧⌘Z 是两个修饰键），只在编辑菜单中。
  redo: { label: '重做' },
  bold: { label: '粗体', shortcut: SHORTCUTS.bold },
  italic: { label: '斜体', shortcut: SHORTCUTS.italic },
  strike: { label: '删除线', shortcut: SHORTCUTS.strike },
  code: { label: '行内代码', shortcut: SHORTCUTS.inlineCode },
  'bullet-list': { label: '无序列表', shortcut: SHORTCUTS.bulletList },
  'ordered-list': { label: '有序列表', shortcut: SHORTCUTS.orderedList },
  quote: { label: '引用', shortcut: SHORTCUTS.quote },
  'code-block': { label: '代码块', shortcut: SHORTCUTS.codeBlock },
  indent: { label: '增加缩进', shortcut: SHORTCUTS.indent },
  outdent: { label: '减少缩进', shortcut: SHORTCUTS.outdent },
  table: { label: '表格', shortcut: SHORTCUTS.insertTable },
  image: { label: '图片…', shortcut: SHORTCUTS.insertImage },
  'row-before': { label: '在上方插入行' },
  'row-after': { label: '在下方插入行' },
  'column-before': { label: '在左侧插入列' },
  'column-after': { label: '在右侧插入列' },
  'delete-row': { label: '删除行' },
  'delete-column': { label: '删除列' },
  'delete-table': { label: '删除表格' },
}

/** 一个编辑命令的菜单项；checkable 时按当前格式打勾。 */
export function commandEntry(
  command: EditorCommand,
  state: CommandState | null,
  options: { readonly checkable?: boolean; readonly label?: string } = {},
): MenuEntry {
  const { label, shortcut } = COMMAND_LABELS[command]
  const item = state?.[command]
  return {
    id: `command:${command}`,
    label: options.label ?? label,
    shortcut,
    disabled: item ? !item.enabled : true,
    checked: options.checkable ? (item?.active ?? false) : undefined,
  }
}

/** figureCaption：选中了独立成段的图片时是它的图注（可能为空），否则为 null。 */
export function editorContextMenu(state: CommandState, figureCaption: string | null): MenuEntry[] {
  if (figureCaption !== null) {
    return [
      { id: 'figure:caption', label: figureCaption === '' ? '添加图注' : '编辑图注' },
      { separator: true },
      { role: 'cut' },
      { role: 'copy' },
    ]
  }
  const entries: MenuEntry[] = []
  const inTable = state['row-after'].enabled
  if (inTable) {
    entries.push(
      commandEntry('row-before', state),
      commandEntry('row-after', state),
      commandEntry('column-before', state),
      commandEntry('column-after', state),
      { separator: true },
      commandEntry('delete-row', state),
      commandEntry('delete-column', state),
      commandEntry('delete-table', state),
      { separator: true },
    )
  }
  entries.push(
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { separator: true },
    commandEntry('bold', state, { checkable: true }),
    commandEntry('italic', state, { checkable: true }),
    commandEntry('strike', state, { checkable: true }),
    commandEntry('code', state, { checkable: true }),
  )
  if (!inTable) {
    entries.push(
      { separator: true },
      commandEntry('bullet-list', state, { checkable: true }),
      commandEntry('ordered-list', state, { checkable: true }),
      commandEntry('quote', state, { checkable: true }),
      commandEntry('code-block', state, { checkable: true }),
      { separator: true },
      commandEntry('table', state, { label: '插入表格' }),
      commandEntry('image', state, { label: '插入图片…' }),
    )
  }
  return entries
}
