import type { AppMenu, Appearance, MenuEntry } from '../../application/desktop_shell.ts'
import type { KeyboardMoveDirection } from '../../application/move_chapter.ts'
import type { CommandState, EditorCommand } from '../editor/commands.ts'
import { COMMAND_LABELS, LIST_COMMANDS, commandEntry } from '../editor/editor_menu.ts'
import { IS_MAC, SHORTCUTS, matchesShortcut } from '../common/shortcuts.ts'

/**
 * 应用菜单栏（文件、编辑、格式、插入、表格、章节、显示）。快捷键的定义在 common/shortcuts.ts；
 * 菜单栏在 macOS 上由系统显示，没有系统菜单栏时工作区按同一份菜单响应快捷键（menuItemForKey）。
 *
 * 可用状态按"当前焦点"决定，与 macOS 的响应链一致：格式命令只在正文获得焦点时可用，
 * 移动与删除章节只在章节树获得焦点时可用。于是同一个按键在同一时刻只有一种含义
 * （例如 ⌘⌫ 在正文中删除到行首，在章节树中请求删除章节）。
 */

/** 键盘焦点所在的区域。text-input 是普通输入框（重命名章节、文档名）。 */
export type FocusRegion = 'editor' | 'tree' | 'text-input' | 'other'

export interface AppMenuContext {
  readonly focus: FocusRegion
  /** 当前章节的编辑命令状态；没有打开章节时为 null。 */
  readonly tools: CommandState | null
  readonly hasSelectedChapter: boolean
  /** 选中章节可以向哪些方向移动。 */
  readonly moves: Readonly<Record<KeyboardMoveDirection, boolean>>
  readonly sidebarVisible: boolean
  readonly exporting: boolean
  /** 文档是否有章节（没有章节时不能全文阅读）。 */
  readonly hasChapters: boolean
  /** 是否在全文阅读中。 */
  readonly reading: boolean
  /** 是否有可以返回 / 再前进的位置（从章节引用前往别处之后）。 */
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly appearance: Appearance
}

const FILE_ACTIONS = ['new', 'open', 'save', 'rename', 'info', 'reveal', 'export-docx', 'export-pdf', 'pdf-layout'] as const
const EDIT_ACTIONS = ['undo', 'redo', 'context-menu', 'list-menu'] as const
const CHAPTER_ACTIONS = ['new', 'new-child', 'rename', 'delete'] as const
const INSERT_ACTIONS = ['update-chapter-refs'] as const
const VIEW_ACTIONS = ['sidebar', 'switch-focus', 'reader', 'back', 'forward'] as const
const MOVE_DIRECTIONS = ['up', 'down', 'outdent', 'indent'] as const satisfies readonly KeyboardMoveDirection[]
const APPEARANCES = ['system', 'light', 'dark'] as const satisfies readonly Appearance[]

type FileAction = (typeof FILE_ACTIONS)[number]
type EditAction = (typeof EDIT_ACTIONS)[number]
type ChapterAction = (typeof CHAPTER_ACTIONS)[number]
type ViewAction = (typeof VIEW_ACTIONS)[number]
type InsertAction = (typeof INSERT_ACTIONS)[number]

/**
 * 菜单项 id：`分组:名称`。系统菜单栏与快捷键只传回这个字符串，由 parseMenuItemId 还原成 MenuCommand。
 * 菜单定义中的 id 按此类型检查，写错会在编译时发现。
 */
export type MenuItemId =
  | `file:${FileAction}`
  | `edit:${EditAction}`
  | `editor:${EditorCommand}`
  | `chapter:${ChapterAction}`
  | `chapter:move-${KeyboardMoveDirection}`
  | `view:${ViewAction}`
  | `insert:${InsertAction}`
  | `appearance:${Appearance}`
  /** 子菜单本身（不对应命令）。 */
  | 'appearance'
  | 'list'

/** 菜单项要执行的命令。 */
export type MenuCommand =
  | { readonly group: 'file'; readonly action: FileAction }
  | { readonly group: 'edit'; readonly action: EditAction }
  /** 正文编辑命令（格式、插入、表格）。 */
  | { readonly group: 'editor'; readonly command: EditorCommand }
  | { readonly group: 'chapter'; readonly action: ChapterAction }
  | { readonly group: 'move-chapter'; readonly direction: KeyboardMoveDirection }
  | { readonly group: 'view'; readonly action: ViewAction }
  | { readonly group: 'insert'; readonly action: InsertAction }
  | { readonly group: 'appearance'; readonly appearance: Appearance }

function oneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

function isEditorCommand(value: string): value is EditorCommand {
  return Object.hasOwn(COMMAND_LABELS, value)
}

/** 菜单项 id → 命令；不认识的 id 返回 null。 */
export function parseMenuItemId(id: string): MenuCommand | null {
  const separator = id.indexOf(':')
  if (separator < 0) return null
  const group = id.slice(0, separator)
  const name = id.slice(separator + 1)
  switch (group) {
    case 'file':
      return oneOf(FILE_ACTIONS, name) ? { group: 'file', action: name } : null
    case 'edit':
      return oneOf(EDIT_ACTIONS, name) ? { group: 'edit', action: name } : null
    case 'editor':
      return isEditorCommand(name) ? { group: 'editor', command: name } : null
    case 'chapter': {
      if (!name.startsWith('move-')) return oneOf(CHAPTER_ACTIONS, name) ? { group: 'chapter', action: name } : null
      const direction = name.slice('move-'.length)
      return oneOf(MOVE_DIRECTIONS, direction) ? { group: 'move-chapter', direction } : null
    }
    case 'view':
      return oneOf(VIEW_ACTIONS, name) ? { group: 'view', action: name } : null
    case 'insert':
      return oneOf(INSERT_ACTIONS, name) ? { group: 'insert', action: name } : null
    case 'appearance':
      return oneOf(APPEARANCES, name) ? { group: 'appearance', appearance: name } : null
    default:
      return null
  }
}

/** id 按 MenuItemId 检查的菜单（结构与 AppMenu 相同，交给 DesktopShell 时不需要转换）。 */
type WorkspaceMenuItem = Omit<Extract<MenuEntry, { readonly id: string }>, 'id' | 'submenu'> & {
  readonly id: MenuItemId
  readonly submenu?: readonly WorkspaceMenuEntry[]
}
type WorkspaceMenuEntry = WorkspaceMenuItem | Exclude<MenuEntry, { readonly id: string }>

export interface WorkspaceMenu extends AppMenu {
  readonly items: readonly WorkspaceMenuEntry[]
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

/**
 * 显示 → 外观：三个互斥的勾选项。
 * 欢迎页与工作区都有，打开文档前也能切换。
 */
function appearanceMenu(current: Appearance): WorkspaceMenuEntry {
  const option = (appearance: Appearance, label: string): WorkspaceMenuItem => ({
    id: `appearance:${appearance}`,
    label,
    checked: current === appearance,
  })
  return {
    id: 'appearance',
    label: '外观',
    submenu: [option('system', '跟随系统'), { separator: true }, option('light', '浅色'), option('dark', '深色')],
  }
}

/** 欢迎页（没有打开文档）时的菜单栏。 */
export function welcomeMenus(appearance: Appearance): WorkspaceMenu[] {
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
    { label: '显示', items: [appearanceMenu(appearance)] },
  ]
}

export function workspaceMenus(context: AppMenuContext): WorkspaceMenu[] {
  const { focus, tools } = context
  const editing = focus === 'editor' && tools !== null
  /** 正文命令：勾选状态总是跟随当前章节，可用状态要求正文获得焦点。 */
  const editorItem = (
    command: EditorCommand,
    options: { checkable?: boolean; label?: string } = {},
  ): WorkspaceMenuEntry => {
    const entry = commandEntry(command, tools, options)
    return editing ? { ...entry, id: `editor:${command}` } : { ...entry, id: `editor:${command}`, disabled: true }
  }
  const undoable = focus === 'text-input'
  const history = (command: 'undo' | 'redo'): WorkspaceMenuEntry => ({
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
        { id: 'file:info', label: '文档信息…' },
        { id: 'file:reveal', label: IS_MAC ? '在访达中显示' : '在文件夹中显示' },
        { separator: true },
        { id: 'file:export-docx', label: '导出为 Word…', disabled: context.exporting },
        { id: 'file:export-pdf', label: '导出为 PDF…', disabled: context.exporting },
        { id: 'file:pdf-layout', label: 'PDF 排版设置…' },
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
        { separator: true },
        // 打开焦点处的操作菜单（与右键菜单相同）：正文中在光标处，章节树中是焦点章节的菜单。
        {
          id: 'edit:context-menu',
          label: '显示操作菜单',
          shortcut: SHORTCUTS.contextMenu,
          disabled: !(editing || (inTree && context.hasSelectedChapter)),
        },
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
        {
          id: 'list', label: '列表',
          submenu: [
            { id: 'edit:list-menu', label: '选择列表…', shortcut: SHORTCUTS.list,
              disabled: !editing || !LIST_COMMANDS.some((command) => tools?.[command].enabled) },
            { separator: true },
            ...LIST_COMMANDS.map((command) => editorItem(command, { checkable: true })),
          ],
        },
        editorItem('quote', { checkable: true }),
        editorItem('code-block', { checkable: true }),
        { separator: true },
        editorItem('indent'),
        editorItem('outdent'),
      ],
    },
    {
      label: '插入',
      items: [
        editorItem('table'),
        editorItem('image'),
        editorItem('chapter-ref'),
        { separator: true },
        // 刷新全部章节引用的链接文字并列出失效引用（docs/decisions.md 第 9 节）。不设快捷键。
        { id: 'insert:update-chapter-refs', label: '更新交叉引用', disabled: !context.hasChapters || context.reading },
      ],
    },
    {
      // 与正文右键菜单中表格的操作相同，光标在表格中时可用。没有自然的"⌘ + 单键"，不设快捷键。
      label: '表格',
      items: [
        editorItem('row-before'),
        editorItem('row-after'),
        editorItem('column-before'),
        editorItem('column-after'),
        { separator: true },
        editorItem('delete-row'),
        editorItem('delete-column'),
        editorItem('delete-table'),
      ],
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
        ...MOVE_LABELS.map(({ direction, label, shortcut }): WorkspaceMenuItem => ({
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
        {
          id: 'view:sidebar',
          label: context.sidebarVisible ? '隐藏侧栏' : '显示侧栏',
          shortcut: SHORTCUTS.toggleSidebar,
        },
        {
          id: 'view:reader',
          label: '全文阅读',
          shortcut: SHORTCUTS.reader,
          checked: context.reading,
          disabled: !context.hasChapters,
        },
        // 从章节引用前往别处之后回到出发的位置，返回后可以再前进（docs/decisions.md 第 9 节）。
        {
          id: 'view:back',
          label: '返回上一位置',
          shortcut: SHORTCUTS.back,
          disabled: !context.canGoBack || context.reading,
        },
        {
          id: 'view:forward',
          label: '前进到下一位置',
          shortcut: SHORTCUTS.forward,
          disabled: !context.canGoForward || context.reading,
        },
        { separator: true },
        // 在章节树与正文之间切换；名称说明这次按下会去哪里。输入框（重命名）中不可用，先确认或放弃输入。
        {
          id: 'view:switch-focus',
          label: inTree ? '转到正文' : '转到章节树',
          shortcut: SHORTCUTS.switchFocus,
          disabled: focus === 'text-input',
        },
        { separator: true },
        appearanceMenu(context.appearance),
      ],
    },
  ]
}

/** 菜单中所有可用、带快捷键的项。 */
function shortcutItems(menus: readonly WorkspaceMenu[]): Array<{ readonly id: MenuItemId; readonly shortcut: string }> {
  const found: Array<{ id: MenuItemId; shortcut: string }> = []
  const visit = (entries: readonly WorkspaceMenuEntry[]) => {
    for (const entry of entries) {
      if ('separator' in entry || 'role' in entry || entry.disabled) continue
      if (entry.submenu) visit(entry.submenu)
      if (entry.shortcut) found.push({ id: entry.id, shortcut: entry.shortcut })
    }
  }
  for (const menu of menus) visit(menu.items)
  return found
}

/**
 * 没有系统菜单栏时由工作区响应快捷键：返回按键对应的可用菜单项 id。
 * 撤销 / 重做不在这里处理：正文与输入框各自处理自己的撤销。
 */
export function menuItemForKey(menus: readonly WorkspaceMenu[], event: KeyboardEvent): MenuItemId | null {
  for (const item of shortcutItems(menus)) {
    if (item.id === 'edit:undo' || item.id === 'edit:redo') continue
    if (matchesShortcut(event, item.shortcut)) return item.id
  }
  return null
}
