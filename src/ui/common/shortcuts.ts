/**
 * Writer 的快捷键：唯一的定义处。
 *
 * 菜单栏（app_menu.ts）、右键菜单、正文编辑器的按键表（editor/plugins.ts）、章节树的按键处理都从这里取值，
 * 菜单中显示的快捷键与实际响应的按键因此总是一致。
 *
 * 规则：Writer 自己定义的快捷键只用"⌘ + 一个键"（Windows / Linux：Ctrl + 一个键），不用单独的功能键。
 * 唯一的例外是文档级命令（新建文档、打开文档）用"⇧⌘ + 一个键"：它们离开当前文档，频率低，
 * 把 ⌘N 留给写作中高频的新建章节；面向整篇文档的全文阅读沿用 Safari 阅读器的 ⇧⌘R。格式与插入命令（格式菜单、插入菜单中的每一项）都有快捷键；章节树的操作（新建、重命名、
 * 移动、删除）与"在章节树和正文之间切换"也都有快捷键，整个写作过程可以只用键盘完成。
 * 其余命令找不到自然、好记、不与 macOS 惯例冲突的单键时宁可不设，命令仍在菜单栏、右键菜单或工具栏中。
 *
 * 同一个按键按焦点所在区域响应（与 macOS 的响应链一致，见 app_shell/app_menu.ts）：
 * ⌘N、⌘↩、⌘ + 方向键、⌘⌫ 只在章节树中作用于章节，
 * 在正文中保持编辑器自己的含义。
 * 系统菜单项（退出、隐藏、最小化、全屏……）的快捷键由系统提供。
 *
 * 快捷键以加速键描述保存（`CmdOrCtrl+B`，与系统菜单相同），显示时按平台换算：macOS 写成 ⌘B，其他平台写成 Ctrl+B。
 */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

export const SHORTCUTS = {
  newDocument: 'CmdOrCtrl+Shift+N',
  openDocument: 'CmdOrCtrl+Shift+O',
  save: 'CmdOrCtrl+S',
  undo: 'CmdOrCtrl+Z',
  bold: 'CmdOrCtrl+B',
  italic: 'CmdOrCtrl+I',
  /** 删除线（deleted）。 */
  strike: 'CmdOrCtrl+D',
  inlineCode: 'CmdOrCtrl+E',
  /** 段落结构用数字键：有序 / 无序列表沿用 Google 文档的 7 / 8，其后是引用、代码块。 */
  orderedList: 'CmdOrCtrl+7',
  bulletList: 'CmdOrCtrl+8',
  quote: 'CmdOrCtrl+9',
  codeBlock: 'CmdOrCtrl+0',
  /** 列表项增加 / 减少缩进（与 Pages、Word 的 ⌘] / ⌘[ 一致）。 */
  indent: 'CmdOrCtrl+]',
  outdent: 'CmdOrCtrl+[',
  insertTable: 'CmdOrCtrl+T',
  /** 插入图片（graphic）。 */
  insertImage: 'CmdOrCtrl+G',
  /**
   * 打开焦点处的操作菜单（与右键菜单、Shift+F10 相同）：正文中在光标处打开（如表格的插入 / 删除行列），
   * 章节树中打开焦点章节的菜单。不用 ⌘K：macOS 上 ⌘K 是"添加链接"，留给将来的插入链接。
   */
  contextMenu: 'CmdOrCtrl+/',
  /** 显示 / 隐藏侧栏（章节树）。注意 Windows / Linux 上 Ctrl+Y 常作重做，Writer 不用它重做。 */
  toggleSidebar: 'CmdOrCtrl+Y',
  /** 在章节树与正文之间切换焦点（jump）。侧栏隐藏时先显示。 */
  switchFocus: 'CmdOrCtrl+J',
  /** 全文阅读（reader）：连续浏览整篇文档，再按一次回到编辑。与 Safari 的“阅读器”相同。 */
  reader: 'CmdOrCtrl+Shift+R',
  /** 在焦点章节之后新建同级章节，随即进入标题编辑。只在章节树获得焦点时有效。 */
  newChapter: 'CmdOrCtrl+N',
  /** 重命名章节。只在章节树获得焦点时有效（单独的 Enter 进入正文）。 */
  renameChapter: 'CmdOrCtrl+Enter',
  /** 上移 / 下移、升级 / 降级章节。只在章节树获得焦点时有效（正文中是光标移到开头 / 结尾、行首 / 行尾）。 */
  moveChapterUp: 'CmdOrCtrl+ArrowUp',
  moveChapterDown: 'CmdOrCtrl+ArrowDown',
  outdentChapter: 'CmdOrCtrl+ArrowLeft',
  indentChapter: 'CmdOrCtrl+ArrowRight',
  /** 请求删除章节（访达"移到废纸篓"的按键）；空章节直接删除，其余先确认。只在章节树获得焦点时有效。 */
  deleteChapter: IS_MAC ? 'CmdOrCtrl+Backspace' : 'CmdOrCtrl+Delete',
} as const

export type ShortcutName = keyof typeof SHORTCUTS

const KEY_CODES: Readonly<Record<string, string>> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '/': 'Slash',
}

/** 按键是否就是加速键描述的组合（修饰键必须完全一致）。字母与数字按物理键比较：⌥ 与 ⇧ 会改变 event.key。 */
export function matchesShortcut(event: KeyboardEvent, shortcut: string, mac = IS_MAC): boolean {
  const parts = shortcut.split('+')
  const key = parts.pop() ?? ''
  const modifiers = new Set(parts)
  const command = modifiers.has('CmdOrCtrl')
  const wants = {
    meta: mac && command,
    ctrl: mac ? modifiers.has('Ctrl') : command || modifiers.has('Ctrl'),
    alt: modifiers.has('Alt'),
    shift: modifiers.has('Shift'),
  }
  if (
    event.metaKey !== wants.meta ||
    event.ctrlKey !== wants.ctrl ||
    event.altKey !== wants.alt ||
    event.shiftKey !== wants.shift
  ) {
    return false
  }
  // 没有物理键信息（程序合成的事件）时按字符比较。
  if (!event.code) return event.key.toLowerCase() === key.toLowerCase()
  if (/^[A-Za-z]$/.test(key)) return event.code === `Key${key.toUpperCase()}`
  if (/^\d$/.test(key)) return event.code === `Digit${key}`
  if (KEY_CODES[key]) return event.code === KEY_CODES[key]
  return event.key === key
}

/**
 * 刷新页面的按键（F5、Ctrl/Cmd+R，含 Shift）一律取消默认行为（App.vue 屏蔽刷新），
 * 但这只是屏蔽浏览器行为，不算“已被处理”：同一个按键若是 Writer 的快捷键（⇧⌘R 全文阅读），仍要响应。
 */
const reloadBlocked = new WeakSet<Event>()

export function blockReload(event: KeyboardEvent): void {
  const reload = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')
  if (!reload || event.defaultPrevented) return
  event.preventDefault()
  reloadBlocked.add(event)
}

/** 按键是否已被焦点处（正文、章节树、输入框……）处理；只被屏蔽了刷新的按键不算。 */
export function isHandled(event: KeyboardEvent): boolean {
  return event.defaultPrevented && !reloadBlocked.has(event)
}

/** 加速键描述 → ProseMirror 按键表的写法（`CmdOrCtrl+B` → `Mod-b`）。 */
export function proseMirrorKey(shortcut: string): string {
  const parts = shortcut.split('+')
  const key = parts.pop() ?? ''
  const modifiers = parts.map((name) => (name === 'CmdOrCtrl' ? 'Mod' : name))
  return [...modifiers, key.length === 1 ? key.toLowerCase() : key].join('-')
}

const MAC_MODIFIERS: ReadonlyArray<readonly [string, string]> = [
  ['Ctrl', '⌃'],
  ['Alt', '⌥'],
  ['Shift', '⇧'],
  ['CmdOrCtrl', '⌘'],
]

const MAC_KEYS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: '⌫',
  Delete: '⌦',
  Enter: '↩',
  Escape: '⎋',
  Tab: '⇥',
}

const OTHER_KEYS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
}

export function formatShortcut(accelerator: string, mac = IS_MAC): string {
  const parts = accelerator.split('+')
  const key = parts.pop() ?? ''
  const modifiers = new Set(parts)
  if (mac) {
    const symbols = MAC_MODIFIERS.filter(([name]) => modifiers.has(name)).map(([, symbol]) => symbol)
    return symbols.join('') + (MAC_KEYS[key] ?? key.toUpperCase())
  }
  const names = [...modifiers].map((name) => (name === 'CmdOrCtrl' ? 'Ctrl' : name))
  return [...names, OTHER_KEYS[key] ?? key.toUpperCase()].join('+')
}
