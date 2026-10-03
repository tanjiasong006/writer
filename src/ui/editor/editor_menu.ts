import type { MenuEntry } from '../../application/desktop_shell.ts'
import type { CommandState, EditorCommand } from './commands.ts'
import { SHORTCUTS } from '../common/shortcuts.ts'
import { CODE_LANGUAGES, sameLanguage } from './code_highlight.ts'
import type { ChapterRefShow } from '../../domain/chapter_reference/chapter_reference.ts'

/**
 * 正文的右键菜单：只列出与点击处直接相关的操作。
 *
 * - 选中的图片：添加 / 编辑图注、剪切 / 拷贝（图片没有单独的尺寸或对齐设置）。
 * - 选中的章节引用：前往目标章节、显示格式（当前格式打勾）、更改目标、剪切 / 拷贝。
 * - 选中的脚注：编辑脚注（`footnote:edit`）、剪切 / 拷贝。
 * - 表格中：插入 / 删除行与列、删除表格，放在最前面。
 * - 代码块中：“代码语言”子菜单放在最前面（当前语言打勾）。
 * - 其余：剪切 / 拷贝 / 粘贴、文字格式、段落结构（当前所在结构打勾）、插入表格与图片。
 *
 * 菜单项 id：`command:<EditorCommand>`；编辑图注是 `figure:caption`；代码语言是 `code-language:<语言>`（空为自动识别）；
 * 章节引用是 `chapter-ref:open` 与 `chapter-ref:show:<格式>`（更改目标是 `command:chapter-ref`）。
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
  'bullet-list': { label: '无序列表' },
  'ordered-list': { label: '有序列表' },
  'task-list': { label: '任务列表' },
  quote: { label: '引用', shortcut: SHORTCUTS.quote },
  'code-block': { label: '代码块', shortcut: SHORTCUTS.codeBlock },
  // 缩进用 Tab / Shift+Tab；⌘[ / ⌘] 是返回 / 前进。
  indent: { label: '增加缩进' },
  outdent: { label: '减少缩进' },
  table: { label: '表格', shortcut: SHORTCUTS.insertTable },
  image: { label: '图片…', shortcut: SHORTCUTS.insertImage },
  'chapter-ref': { label: '章节引用…', shortcut: SHORTCUTS.chapterRef },
  // 脚注没有自然的“⌘ + 单键”（Word 的 ⌥⌘F 是两个修饰键），只在插入菜单与右键菜单中。
  footnote: { label: '脚注…' },
  // 文献引用同样没有自然的单键，只在插入菜单与右键菜单中。
  citation: { label: '文献引用…' },
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
): Omit<Extract<MenuEntry, { readonly id: string }>, 'submenu'> {
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

export const LIST_COMMANDS = ['bullet-list', 'ordered-list', 'task-list'] as const

export function listEntries(state: CommandState | null): MenuEntry[] {
  return LIST_COMMANDS.map((command) => commandEntry(command, state, { checkable: true }))
}

/** 代码语言子菜单：自动识别、常用语言；手写的其他语言名也列出并打勾，选择其他项时替换它。 */
function codeLanguageMenu(current: string): MenuEntry {
  const known = current === '' || CODE_LANGUAGES.some((language) => sameLanguage(language.id, current))
  return {
    id: 'code-language',
    label: '代码语言',
    submenu: [
      { id: 'code-language:', label: '自动识别', checked: current === '' },
      ...(known ? [] : [{ id: `code-language:${current}`, label: current, checked: true }]),
      { separator: true },
      ...CODE_LANGUAGES.map((language) => ({
        id: `code-language:${language.id}`,
        label: language.label,
        checked: current !== '' && sameLanguage(language.id, current),
      })),
    ],
  }
}

/** 选中的章节引用：目标的完整名称（失效时为 null）与显示格式（地址格式错误时为 null）。 */
export interface ChapterRefMenu {
  readonly name: string | null
  readonly show: ChapterRefShow | null
  /** 是文献引用（没有前往与显示格式，只能更改文献）。 */
  readonly citation?: boolean
}

const SHOW_LABELS: ReadonlyArray<readonly [ChapterRefShow, string]> = [
  ['number-title', '编号 + 标题'],
  ['number', '仅编号'],
  ['title', '仅标题'],
]

function chapterRefMenu(state: CommandState, ref: ChapterRefMenu): MenuEntry[] {
  if (ref.citation) {
    return [commandEntry('citation', state, { label: '更改文献…' }), { separator: true }, { role: 'cut' }, { role: 'copy' }]
  }
  return [
    ref.name === null
      ? { id: 'chapter-ref:open', label: '前往（引用已失效）', disabled: true }
      : { id: 'chapter-ref:open', label: `前往“${ref.name}”` },
    {
      id: 'chapter-ref-show',
      label: '显示格式',
      submenu: SHOW_LABELS.map(([show, label]) => ({
        id: `chapter-ref:show:${show}`,
        label,
        checked: ref.show === show,
        disabled: ref.show === null,
      })),
    },
    commandEntry('chapter-ref', state, { label: '更改目标…' }),
    { separator: true },
    { role: 'cut' },
    { role: 'copy' },
  ]
}

/**
 * figureCaption：选中了独立成段的图片时是它的图注（可能为空），否则为 null。
 * codeLanguage：光标在代码块中时是它声明的语言（没有时为空字符串），否则为 null。
 * chapterRef：选中了章节引用时是它的目标与格式，否则为 null。
 */
export function editorContextMenu(
  state: CommandState,
  figureCaption: string | null,
  codeLanguage: string | null = null,
  chapterRef: ChapterRefMenu | null = null,
  footnote = false,
  /** 光标在表格中时表格是否有标题；不在表格中时为 null。 */
  tableCaption: boolean | null = null,
): MenuEntry[] {
  if (chapterRef !== null) return chapterRefMenu(state, chapterRef)
  if (footnote) {
    return [{ id: 'footnote:edit', label: '编辑脚注…' }, { separator: true }, { role: 'cut' }, { role: 'copy' }]
  }
  if (figureCaption !== null) {
    return [
      { id: 'figure:caption', label: figureCaption === '' ? '添加图注' : '编辑图注' },
      { separator: true },
      { role: 'cut' },
      { role: 'copy' },
    ]
  }
  const entries: MenuEntry[] = []
  if (codeLanguage !== null) entries.push(codeLanguageMenu(codeLanguage), { separator: true })
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
      { id: 'table:caption', label: tableCaption ? '编辑表格标题…' : '添加表格标题…' },
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
      { id: 'list', label: '列表', submenu: listEntries(state) },
      commandEntry('quote', state, { checkable: true }),
      commandEntry('code-block', state, { checkable: true }),
      { separator: true },
      commandEntry('table', state, { label: '插入表格' }),
      commandEntry('image', state, { label: '插入图片…' }),
      commandEntry('chapter-ref', state, { label: '插入章节引用…' }),
      commandEntry('footnote', state, { label: '插入脚注…' }),
      commandEntry('citation', state, { label: '插入文献引用…' }),
    )
  }
  return entries
}
