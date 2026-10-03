import { describe, expect, test } from 'vitest'
import type { AppMenu, MenuEntry } from '../../application/desktop_shell.ts'
import { commandState } from '../editor/commands.ts'
import { createEditorState } from '../editor/plugins.ts'
import { parseMarkdown } from '../editor/markdown.ts'
import {
  menuItemForKey,
  parseMenuItemId,
  welcomeMenus,
  workspaceMenus,
  type AppMenuContext,
} from './app_menu.ts'
import { IS_MAC, SHORTCUTS, matchesShortcut } from '../common/shortcuts.ts'

const tools = commandState(createEditorState(parseMarkdown('正文')))

function context(patch: Partial<AppMenuContext> = {}): AppMenuContext {
  return {
    focus: 'editor',
    tools,
    hasSelectedChapter: true,
    moves: { up: true, down: true, outdent: false, indent: true },
    sidebarVisible: true,
    exporting: false,
    hasChapters: true,
    reading: false,
    canGoBack: false,
    canGoForward: false,
    appearance: 'system',
    ...patch,
  }
}

function item(menus: readonly AppMenu[], id: string): Extract<MenuEntry, { id: string }> {
  const visit = (entries: readonly MenuEntry[]): Extract<MenuEntry, { id: string }> | null => {
    for (const entry of entries) {
      if ('separator' in entry || 'role' in entry) continue
      if (entry.id === id) return entry
      const inner = entry.submenu ? visit(entry.submenu) : null
      if (inner) return inner
    }
    return null
  }
  for (const menu of menus) {
    const found = visit(menu.items)
    if (found) return found
  }
  throw new Error(`no ${id}`)
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('可用状态随焦点变化（响应链）', () => {
  test('格式命令只在正文获得焦点时可用，勾选状态始终跟随当前章节', () => {
    expect(item(workspaceMenus(context()), 'editor:bold').disabled).toBe(false)
    const inTree = workspaceMenus(context({ focus: 'tree' }))
    expect(item(inTree, 'editor:bold').disabled).toBe(true)
    expect(item(inTree, 'editor:bold').checked).toBe(false)
  })

  test('移动章节只在章节树获得焦点、且可以移动时可用', () => {
    expect(item(workspaceMenus(context()), 'chapter:move-up').disabled).toBe(true)
    const inTree = workspaceMenus(context({ focus: 'tree' }))
    expect(item(inTree, 'chapter:move-up').disabled).toBe(false)
    expect(item(inTree, 'chapter:move-outdent').disabled).toBe(true)
  })

  test('撤销：正文按自己的历史，输入框交给浏览器，其他位置不可用', () => {
    expect(item(workspaceMenus(context()), 'edit:undo').disabled).toBe(true) // 没有可撤销的修改
    expect(item(workspaceMenus(context({ focus: 'text-input' })), 'edit:undo').disabled).toBe(false)
    expect(item(workspaceMenus(context({ focus: 'other' })), 'edit:undo').disabled).toBe(true)
  })

  test('没有章节时章节命令不可用；菜单中没有导出效果的预览', () => {
    expect(parseMenuItemId('view:preview')).toBeNull()
    const empty = workspaceMenus(context({ hasSelectedChapter: false, tools: null }))
    expect(item(empty, 'chapter:rename').disabled).toBe(true)
    expect(item(empty, 'chapter:new').disabled).toBeUndefined()
  })

  test('表格菜单：光标在表格中时可用，其他位置不可用', () => {
    const inCell = commandState(createEditorState(parseMarkdown('| a |\n| --- |\n| b |\n')))
    // 新建状态的光标在第一个单元格（表头）中：可以在下方插入行，不能删除表头行。
    const menus = workspaceMenus(context({ tools: inCell }))
    expect(item(menus, 'editor:row-after').disabled).toBe(false)
    expect(item(menus, 'editor:delete-table').disabled).toBe(false)
    expect(item(menus, 'editor:delete-row').disabled).toBe(true)
    expect(item(workspaceMenus(context()), 'editor:row-after').disabled).toBe(true)
    expect(item(workspaceMenus(context({ tools: inCell, focus: 'tree' })), 'editor:row-after').disabled).toBe(true)
  })

  test('⌘/ 在正文与章节树中打开操作菜单；其他位置不响应', () => {
    const slash = key({ key: '/', code: 'Slash', ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }) })
    expect(item(workspaceMenus(context()), 'edit:context-menu').shortcut).toBe(SHORTCUTS.contextMenu)
    expect(menuItemForKey(workspaceMenus(context()), slash)).toBe('edit:context-menu')
    expect(menuItemForKey(workspaceMenus(context({ focus: 'tree' })), slash)).toBe('edit:context-menu')
    expect(menuItemForKey(workspaceMenus(context({ focus: 'tree', hasSelectedChapter: false })), slash)).toBeNull()
    expect(menuItemForKey(workspaceMenus(context({ focus: 'other' })), slash)).toBeNull()
  })

  test('全文阅读：任何焦点下都可以用 ⇧⌘R 打开或关闭，阅读中打勾；没有章节时不可用', () => {
    const shortcut = key({
      key: 'R',
      code: 'KeyR',
      shiftKey: true,
      ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }),
    })
    for (const focus of ['editor', 'tree', 'other'] as const) {
      expect(menuItemForKey(workspaceMenus(context({ focus })), shortcut)).toBe('view:reader')
    }
    expect(parseMenuItemId('view:reader')).toEqual({ group: 'view', action: 'reader' })
    expect(item(workspaceMenus(context()), 'view:reader').checked).toBe(false)
    expect(item(workspaceMenus(context({ reading: true })), 'view:reader').checked).toBe(true)
    expect(item(workspaceMenus(context({ hasChapters: false })), 'view:reader').disabled).toBe(true)
  })

  test('导出进行中不能再次导出；侧栏项的名称随状态变化', () => {
    const menus = workspaceMenus(context({ exporting: true, sidebarVisible: false }))
    expect(item(menus, 'file:export-pdf').disabled).toBe(true)
    expect(item(menus, 'view:sidebar').label).toBe('显示侧栏')
  })

  test('显示 → 外观：三个互斥的勾选项，欢迎页也有', () => {
    const checked = (menus: readonly AppMenu[]) =>
      (['system', 'light', 'dark'] as const).filter((appearance) => item(menus, `appearance:${appearance}`).checked)
    expect(checked(workspaceMenus(context()))).toEqual(['system'])
    expect(checked(workspaceMenus(context({ appearance: 'dark' })))).toEqual(['dark'])
    expect(checked(welcomeMenus('light'))).toEqual(['light'])
    expect(item(welcomeMenus('system'), 'appearance').submenu).toHaveLength(4)
    expect(parseMenuItemId('appearance:dark')).toEqual({ group: 'appearance', appearance: 'dark' })
    expect(parseMenuItemId('appearance:sepia')).toBeNull()
  })
})

/** 菜单中所有带快捷键的项。 */
function shortcuts(menus: readonly AppMenu[]): Array<[string, string]> {
  const found: Array<[string, string]> = []
  const visit = (entries: readonly MenuEntry[]) => {
    for (const entry of entries) {
      if ('separator' in entry || 'role' in entry) continue
      if (entry.submenu) visit(entry.submenu)
      if (entry.shortcut) found.push([entry.id, entry.shortcut])
    }
  }
  for (const menu of menus) visit(menu.items)
  return found
}

describe('快捷键', () => {
  test('Writer 自己的快捷键只用"⌘ + 一个键"；新建 / 打开文档与全文阅读例外，用"⇧⌘ + 一个键"', () => {
    const all = [
      ...Object.values(SHORTCUTS),
      ...shortcuts(workspaceMenus(context())).map(([, shortcut]) => shortcut),
      ...shortcuts(workspaceMenus(context({ focus: 'tree' }))).map(([, shortcut]) => shortcut),
      ...shortcuts(welcomeMenus('system')).map(([, shortcut]) => shortcut),
    ]
    const documentLevel = new Set<string>([SHORTCUTS.newDocument, SHORTCUTS.openDocument, SHORTCUTS.reader])
    for (const shortcut of all) {
      const modifiers = documentLevel.has(shortcut) ? ['CmdOrCtrl', 'Shift'] : ['CmdOrCtrl']
      expect(shortcut.split('+').slice(0, -1), shortcut).toEqual(modifiers)
    }
  })

  test('格式菜单与插入菜单中的每一项都有快捷键', () => {
    const entries = workspaceMenus(context())
      .filter((menu) => menu.label === '格式' || menu.label === '插入')
      .flatMap((menu) => menu.items)
      // “更新交叉引用”作用于整篇文档，不是插入命令，不设快捷键（docs/decisions.md 第 9 节）。
      // 列表缩进用正文中的 Tab / Shift+Tab（不能作菜单快捷键），⌘[ / ⌘] 留给返回 / 前进。
      // 脚注没有自然的“⌘ + 单键”（Word 是 ⌥⌘F，Pages 不设），只在菜单中。
      .filter((entry) => 'id' in entry && !['insert:update-chapter-refs', 'editor:indent', 'editor:outdent', 'editor:footnote', 'editor:citation', 'editor:math', 'editor:math-block', 'insert:references'].includes(entry.id))
    for (const entry of entries) {
      if (!('id' in entry)) continue
      if (entry.submenu) expect(shortcuts([{ label: entry.label, items: entry.submenu }]).length).toBeGreaterThan(0)
      else expect(entry.shortcut, entry.id).toBeDefined()
    }
  })

  test('同一时刻可用的快捷键互不重复', () => {
    for (const focus of ['editor', 'tree', 'other'] as const) {
      const all = shortcuts(workspaceMenus(context({ focus })).map((menu) => ({
        ...menu,
        items: menu.items.filter((entry) => 'separator' in entry || 'role' in entry || !entry.disabled),
      }))).map(([, shortcut]) => shortcut)
      expect(new Set(all).size, focus).toBe(all.length)
    }
  })

  test('章节操作的快捷键只在章节树中有效；正文中这些键保持编辑器的含义', () => {
    const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true }
    const keys = {
      new: key({ key: 'n', code: 'KeyN', ...mod }),
      rename: key({ key: 'Enter', code: 'Enter', ...mod }),
      up: key({ key: 'ArrowUp', code: 'ArrowUp', ...mod }),
      indent: key({ key: 'ArrowRight', code: 'ArrowRight', ...mod }),
    }
    const inTree = workspaceMenus(context({ focus: 'tree' }))
    expect(menuItemForKey(inTree, keys.new)).toBe('chapter:new')
    expect(menuItemForKey(inTree, keys.rename)).toBe('chapter:rename')
    expect(menuItemForKey(inTree, keys.up)).toBe('chapter:move-up')
    expect(menuItemForKey(inTree, keys.indent)).toBe('chapter:move-indent')

    const inEditor = workspaceMenus(context())
    expect(menuItemForKey(inEditor, keys.new)).toBeNull()
    expect(menuItemForKey(inEditor, key({ key: 'N', code: 'KeyN', shiftKey: true, ...mod }))).toBe('file:new')
    expect(menuItemForKey(inEditor, keys.rename)).toBeNull()
    expect(menuItemForKey(inEditor, keys.up)).toBeNull()
    expect(menuItemForKey(inEditor, keys.indent)).toBeNull()
    // 菜单项本身仍可点击。
    expect(item(inEditor, 'chapter:new').disabled).toBeUndefined()
    expect(item(inEditor, 'chapter:rename').disabled).toBe(false)
  })

  test('⌘J 在章节树与正文之间切换：名称说明去向；输入框中不可用', () => {
    expect(item(workspaceMenus(context()), 'view:switch-focus').label).toBe('转到章节树')
    expect(item(workspaceMenus(context({ focus: 'tree' })), 'view:switch-focus').label).toBe('转到正文')
    expect(item(workspaceMenus(context({ focus: 'text-input' })), 'view:switch-focus').disabled).toBe(true)
  })

  test('菜单显示的快捷键都来自同一张快捷键表', () => {
    const table = new Set<string>(Object.values(SHORTCUTS))
    for (const [id, shortcut] of shortcuts(workspaceMenus(context({ focus: 'tree' })))) {
      expect(table.has(shortcut), id).toBe(true)
    }
  })

  test('按物理键比较：⌥ 改变了字符也能匹配', () => {
    expect(matchesShortcut(key({ key: '‘', code: 'BracketRight', metaKey: true }), 'CmdOrCtrl+]', true)).toBe(true)
    expect(matchesShortcut(key({ key: 'Backspace', code: 'Backspace', metaKey: true }), 'CmdOrCtrl+Backspace', true)).toBe(true)
  })

  test('修饰键必须完全一致：macOS 上 ⌃B 不是 ⌘B（⌃B 在文本中是光标左移），⇧⌘B 也不是 ⌘B', () => {
    expect(matchesShortcut(key({ key: 'b', code: 'KeyB', ctrlKey: true }), 'CmdOrCtrl+B', true)).toBe(false)
    expect(matchesShortcut(key({ key: 'b', code: 'KeyB', ctrlKey: true }), 'CmdOrCtrl+B', false)).toBe(true)
    expect(matchesShortcut(key({ key: 'B', code: 'KeyB', metaKey: true, shiftKey: true }), 'CmdOrCtrl+B', true)).toBe(false)
  })

  test('只响应可用的项；删除章节只在章节树中；撤销留给正文与输入框自己处理', () => {
    const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true }
    const deleteKey = IS_MAC ? { key: 'Backspace', code: 'Backspace' } : { key: 'Delete', code: 'Delete' }
    const inTree = workspaceMenus(context({ focus: 'tree' }))
    expect(menuItemForKey(inTree, key({ key: 'b', code: 'KeyB', ...mod }))).toBeNull()
    expect(menuItemForKey(inTree, key({ key: 's', code: 'KeyS', ...mod }))).toBe('file:save')
    expect(menuItemForKey(inTree, key({ ...deleteKey, ...mod }))).toBe('chapter:delete')
    expect(menuItemForKey(inTree, key({ key: 't', code: 'KeyT', ...mod }))).toBeNull()
    expect(menuItemForKey(inTree, key({ key: 'y', code: 'KeyY', ...mod }))).toBe('view:sidebar')
    const inEditor = workspaceMenus(context())
    expect(menuItemForKey(inEditor, key({ ...deleteKey, ...mod }))).toBeNull()
    expect(menuItemForKey(inEditor, key({ key: 't', code: 'KeyT', ...mod }))).toBe('editor:table')
    expect(menuItemForKey(inEditor, key({ key: '8', code: 'Digit8', ...mod }))).toBe('edit:list-menu')
    expect(menuItemForKey(inEditor, key({ key: 'l', code: 'KeyL', ...mod }))).toBeNull() // 没有文档样式
    const inInput = workspaceMenus(context({ focus: 'text-input' }))
    expect(menuItemForKey(inInput, key({ key: 'z', code: 'KeyZ', ...mod }))).toBeNull()
  })

  test('重做只在编辑菜单中，没有快捷键', () => {
    expect(item(workspaceMenus(context()), 'edit:redo').shortcut).toBeUndefined()
  })
})

describe('菜单项 id', () => {
  test('菜单中的每一项都能还原成命令', () => {
    for (const focus of ['editor', 'tree', 'text-input', 'other'] as const) {
      const entries = [...welcomeMenus('system'), ...workspaceMenus(context({ focus }))].flatMap((menu) => menu.items)
      const visit = (list: readonly MenuEntry[]): void => {
        for (const entry of list) {
          if (!('id' in entry)) continue
          // 子菜单本身不对应命令，只检查其中的项。
          if (entry.submenu) visit(entry.submenu)
          else expect(parseMenuItemId(entry.id), entry.id).not.toBeNull()
        }
      }
      visit(entries)
    }
  })

  test('按分组还原', () => {
    expect(parseMenuItemId('file:export-pdf')).toEqual({ group: 'file', action: 'export-pdf' })
    expect(parseMenuItemId('editor:bold')).toEqual({ group: 'editor', command: 'bold' })
    expect(parseMenuItemId('chapter:new-child')).toEqual({ group: 'chapter', action: 'new-child' })
    expect(parseMenuItemId('chapter:move-indent')).toEqual({ group: 'move-chapter', direction: 'indent' })
    expect(parseMenuItemId('view:switch-focus')).toEqual({ group: 'view', action: 'switch-focus' })
  })

  test('不认识的 id 返回 null', () => {
    for (const id of ['', 'file', 'file:', 'file:print', 'editor:toString', 'chapter:move-left', 'chapter:move-', 'help:about']) {
      expect(parseMenuItemId(id), id).toBeNull()
    }
  })
})

test('插入章节引用（⌘K）、返回上一位置（⌘[）与前进到下一位置（⌘]）', () => {
  const insert = workspaceMenus(context()).find((menu) => menu.label === '插入')!
  expect(insert.items).toContainEqual(
    expect.objectContaining({ id: 'editor:chapter-ref', label: '章节引用…', shortcut: SHORTCUTS.chapterRef, disabled: false }),
  )
  const view = (patch: Partial<AppMenuContext>, id: string) =>
    workspaceMenus(context(patch))
      .find((menu) => menu.label === '显示')!
      .items.find((item) => 'id' in item && item.id === id)
  expect(view({}, 'view:back')).toMatchObject({ label: '返回上一位置', shortcut: 'CmdOrCtrl+[', disabled: true })
  expect(view({ canGoBack: true }, 'view:back')).toMatchObject({ disabled: false })
  expect(view({ canGoBack: true, reading: true }, 'view:back')).toMatchObject({ disabled: true })
  expect(view({}, 'view:forward')).toMatchObject({ label: '前进到下一位置', shortcut: 'CmdOrCtrl+]', disabled: true })
  expect(view({ canGoForward: true }, 'view:forward')).toMatchObject({ disabled: false })
  expect(view({ canGoForward: true, reading: true }, 'view:forward')).toMatchObject({ disabled: true })
  expect(parseMenuItemId('view:back')).toEqual({ group: 'view', action: 'back' })
  expect(parseMenuItemId('view:forward')).toEqual({ group: 'view', action: 'forward' })

  // 正文中也响应：列表缩进不再占用 ⌘[ / ⌘]。
  const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true }
  const key = (code: string) => new KeyboardEvent('keydown', { key: code === 'BracketLeft' ? '[' : ']', code, ...mod })
  const menus = workspaceMenus(context({ canGoBack: true, canGoForward: true }))
  expect(menuItemForKey(menus, key('BracketLeft'))).toBe('view:back')
  expect(menuItemForKey(menus, key('BracketRight'))).toBe('view:forward')
})

test('更新交叉引用：有章节、不在全文阅读中时可用', () => {
  const item = (patch: Partial<AppMenuContext>) =>
    workspaceMenus(context(patch))
      .find((menu) => menu.label === '插入')!
      .items.find((entry) => 'id' in entry && entry.id === 'insert:update-chapter-refs')
  expect(item({})).toMatchObject({ label: '更新交叉引用', disabled: false })
  expect(item({ hasChapters: false })).toMatchObject({ disabled: true })
  expect(item({ reading: true })).toMatchObject({ disabled: true })
  expect(parseMenuItemId('insert:update-chapter-refs')).toEqual({ group: 'insert', action: 'update-chapter-refs' })
})
