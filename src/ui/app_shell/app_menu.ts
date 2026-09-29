import type { AppMenu, MenuEntry } from '../../application/desktop_shell.ts'
import type { KeyboardMoveDirection } from '../../application/move_chapter.ts'
import type { CommandState, EditorCommand } from '../editor/commands.ts'
import { COMMAND_LABELS, commandEntry } from '../editor/editor_menu.ts'
import { IS_MAC, SHORTCUTS, matchesShortcut } from '../common/shortcuts.ts'

/**
 * 应用菜单栏（文件、编辑、格式、插入、章节、显示）。快捷键的定义在 common/shortcuts.ts；
 * 菜单栏在 macOS 上由系统显示，没有系统菜单栏时工作区按同一份菜单响应快捷键（menuItemForKey）。
 *
 * 可用状态按"当前焦点"决定，与 macOS 的响应链一致：格式命令只在正文获得焦点时可用，
 * 移动与删除章节只在章节树获得焦点时可用。于是同一个按键在同一时刻只有一种含义
 * （例如 ⌘⌫ 在正文中删除到行首，在章节树中请求删除章节）。
 */

/** 键盘焦点所在的区域。text-input 是普通输入框（重命名章节、文档名）。 */
export type FocusRegion = 'editor' | 'tree' | 'text-input' | 'other'

export interface AppMenuContext {
  readonly mode: 'edit' | 'preview'
  readonly focus: FocusRegion
  /** 当前章节的编辑命令状态；没有打开章节时为 null。 */
  readonly tools: CommandState | null
  readonly hasSelectedChapter: boolean
  /** 选中章节可以向哪些方向移动。 */
  readonly moves: Readonly<Record<KeyboardMoveDirection, boolean>>
  readonly sidebarVisible: boolean
  readonly exporting: boolean
}

/** 上移 / 下移 / 升级 / 降级：只在章节树获得焦点时可用（快捷键在正文中另有含义）。 */
export const MOVE_LABELS: ReadonlyArray<{
  readonly direction: KeyboardMoveDirection
  readonly label: string
  readonly shortcut: string
}> = [
  { direction: 'up', label: '上移', shortcut: SHORTCUTS.moveChapterUp },
  { direction: 'down', label: '下移', shortcut: SHORTCUTS.moveChapterDown },
  { direction: 'outdent', label: '升级', shortcut: SHORTCUTS.outdentChapter },
  { direction: 'indent', label: '降级', shortcut: SHORTCUTS.indentChapter },
]

/** 欢迎页（没有打开文档）时的菜单栏。 */
export function welcomeMenus(): AppMenu[] {
  return [
    {
      label: '文件',
      items: [
        { id: 'file:new', label: '新建文档…', shortcut: SHORTCUTS.newDocument },
        { id: 'file:open', label: '打开文档…', shortcut: SHORTCUTS.openDocument },
        { separator: true },
        { role: 'close-window' },
      ],
    },
    { label: '编辑', items: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'select-all' }] },
  ]
}

export function workspaceMenus(context: AppMenuContext): AppMenu[] {
  const { mode, focus, tools } = context
  const editing = mode === 'edit' && focus === 'editor' && tools !== null
  /** 正文命令：勾选状态总是跟随当前章节，可用状态要求正文获得焦点。 */
  const editorItem = (command: EditorCommand, options: { checkable?: boolean; label?: string } = {}): MenuEntry => {
    const entry = commandEntry(command, tools, options)
    return editing ? { ...entry, id: `editor:${command}` } : { ...entry, id: `editor:${command}`, disabled: true }
  }
  const undoable = focus === 'text-input'
  const history = (command: 'undo' | 'redo'): MenuEntry => ({
    id: `edit:${command}`,
    label: COMMAND_LABELS[command].label,
    shortcut: COMMAND_LABELS[command].shortcut,
    disabled: !(undoable || (editing && tools![command].enabled)),
  })
  const inTree = focus === 'tree'

  return [
    {
      label: '文件',
      items: [
        { id: 'file:new', label: '新建文档…', shortcut: SHORTCUTS.newDocument },
        { id: 'file:open', label: '打开文档…', shortcut: SHORTCUTS.openDocument },
        { separator: true },
        { role: 'close-window' },
        { id: 'file:save', label: '保存', shortcut: SHORTCUTS.save },
        { separator: true },
        { id: 'file:rename', label: '重命名文档' },
        { id: 'file:reveal', label: IS_MAC ? '在访达中显示' : '在文件夹中显示' },
        { separator: true },
        { id: 'file:export-docx', label: '导出为 Word…', disabled: context.exporting },
        { id: 'file:export-pdf', label: '导出为 PDF…', disabled: context.exporting },
      ],
    },
    {
      label: '编辑',
      items: [
        history('undo'),
        history('redo'),
        { separator: true },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'select-all' },
      ],
    },
    {
      label: '格式',
      items: [
        editorItem('bold', { checkable: true }),
        editorItem('italic', { checkable: true }),
        editorItem('strike', { checkable: true }),
        editorItem('code', { checkable: true }),
        { separator: true },
        editorItem('bullet-list', { checkable: true }),
        editorItem('ordered-list', { checkable: true }),
        editorItem('quote', { checkable: true }),
        editorItem('code-block', { checkable: true }),
        { separator: true },
        editorItem('indent'),
        editorItem('outdent'),
        { separator: true },
        { id: 'format:style', label: '文档样式…', shortcut: SHORTCUTS.documentStyle },
      ],
    },
    {
      label: '插入',
      items: [editorItem('table'), editorItem('image')],
    },
    {
      label: '章节',
      items: [
        // 新建与重命名在任何位置都可以从菜单执行，快捷键只在章节树中（正文中 ⌘↩ 是编辑器自己的按键）。
        { id: 'chapter:new', label: '新建章节', shortcut: inTree ? SHORTCUTS.newChapter : undefined },
        { id: 'chapter:new-child', label: '新建子章节', disabled: !context.hasSelectedChapter },
        { separator: true },
        {
          id: 'chapter:rename',
          label: '重命名章节',
          shortcut: inTree ? SHORTCUTS.renameChapter : undefined,
          disabled: !context.hasSelectedChapter,
        },
        { separator: true },
        ...MOVE_LABELS.map(({ direction, label, shortcut }) => ({
          id: `chapter:move-${direction}`,
          label,
          shortcut,
          disabled: !(inTree && context.moves[direction]),
        })),
        { separator: true },
        {
          id: 'chapter:delete',
          label: '删除章节',
          shortcut: SHORTCUTS.deleteChapter,
          disabled: !(inTree && context.hasSelectedChapter),
        },
      ],
    },
    {
      label: '显示',
      items: [
        // 全文预览没有自然的"⌘ + 单键"，不设快捷键；预览中按 Esc 回到编辑。
        {
          id: 'view:sidebar',
          label: context.sidebarVisible ? '隐藏侧栏' : '显示侧栏',
          shortcut: SHORTCUTS.toggleSidebar,
        },
        // 在章节树与正文之间切换；名称说明这次按下会去哪里。输入框（重命名）中不可用，先确认或放弃输入。
        {
          id: 'view:switch-focus',
          label: inTree ? '转到正文' : '转到章节树',
          shortcut: SHORTCUTS.switchFocus,
          disabled: focus === 'text-input',
        },
        { separator: true },
        { id: 'view:preview', label: '全文预览', checked: mode === 'preview' },
      ],
    },
  ]
}

/** 菜单中所有可用、带快捷键的项。 */
function shortcutItems(menus: readonly AppMenu[]): Array<{ readonly id: string; readonly shortcut: string }> {
  const found: Array<{ id: string; shortcut: string }> = []
  const visit = (entries: readonly MenuEntry[]) => {
    for (const entry of entries) {
      if ('separator' in entry || 'role' in entry) continue
      if (entry.submenu) visit(entry.submenu)
      else if (entry.shortcut && !entry.disabled) found.push({ id: entry.id, shortcut: entry.shortcut })
    }
  }
  for (const menu of menus) visit(menu.items)
  return found
}

/**
 * 没有系统菜单栏时由工作区响应快捷键：返回按键对应的可用菜单项 id。
 * 撤销 / 重做不在这里处理：正文与输入框各自处理自己的撤销。
 */
export function menuItemForKey(menus: readonly AppMenu[], event: KeyboardEvent): string | null {
  for (const item of shortcutItems(menus)) {
    if (item.id === 'edit:undo' || item.id === 'edit:redo') continue
    if (matchesShortcut(event, item.shortcut)) return item.id
  }
  return null
}
