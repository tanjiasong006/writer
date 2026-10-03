import { LogicalPosition } from '@tauri-apps/api/dpi'
import {
  CheckMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
  type MenuItemOptions,
} from '@tauri-apps/api/menu'
import type { AppMenu, MenuEntry } from '../application/desktop_shell.ts'

/**
 * 系统菜单（macOS 菜单栏与右键菜单）。
 *
 * 菜单栏的结构只在第一次（或结构改变时）创建；之后同样结构的调用只更新可用 / 勾选状态，
 * 焦点每次移动都会调用，不能每次重建几十个系统菜单项。
 *
 * 菜单栏更新与弹出菜单共用一个队列，严格串行：Tauri 的 popup 在等待主线程显示菜单期间占着菜单资源表，
 * 此时主线程上若在执行菜单栏的 set_enabled（同样要占资源表）就会互相等待、整个应用卡死
 * （右键章节会同时移动焦点、触发菜单栏更新，真实运行中复现过）。
 */

type Item = MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu

const ROLES = {
  cut: { item: 'Cut', text: '剪切' },
  copy: { item: 'Copy', text: '拷贝' },
  paste: { item: 'Paste', text: '粘贴' },
  'select-all': { item: 'SelectAll', text: '全选' },
  'close-window': { item: 'CloseWindow', text: '关闭窗口' },
} as const

function isSeparator(entry: MenuEntry): entry is { readonly separator: true } {
  return 'separator' in entry
}

function isRole(entry: MenuEntry): entry is Extract<MenuEntry, { role: string }> {
  return 'role' in entry
}

async function createEntries(
  entries: readonly MenuEntry[],
  onSelect: (id: string) => void,
  registry: Map<string, MenuItem | CheckMenuItem> | null,
): Promise<Item[]> {
  const items: Item[] = []
  for (const entry of entries) {
    if (isSeparator(entry)) {
      items.push(await PredefinedMenuItem.new({ item: 'Separator' }))
    } else if (isRole(entry)) {
      items.push(await PredefinedMenuItem.new(ROLES[entry.role]))
    } else if (entry.submenu) {
      items.push(
        await Submenu.new({
          text: entry.label,
          enabled: !entry.disabled,
          items: await createEntries(entry.submenu, onSelect, registry),
        }),
      )
    } else {
      const options: MenuItemOptions = {
        id: entry.id,
        text: entry.label,
        enabled: !entry.disabled,
        accelerator: entry.shortcut,
        action: () => onSelect(entry.id),
      }
      const item =
        entry.checked === undefined
          ? await MenuItem.new(options)
          : await CheckMenuItem.new({ ...options, checked: entry.checked })
      registry?.set(entry.id, item)
      items.push(item)
    }
  }
  return items
}

/** 菜单的结构（不含可用 / 勾选状态）：结构相同时只需更新状态。 */
function structureOf(menus: readonly AppMenu[]): string {
  const describe = (entries: readonly MenuEntry[]): unknown[] =>
    entries.map((entry) => {
      if (isSeparator(entry)) return '-'
      if (isRole(entry)) return entry.role
      return [entry.id, entry.label, entry.shortcut ?? '', entry.checked === undefined, describe(entry.submenu ?? [])]
    })
  return JSON.stringify(menus.map((menu) => [menu.label, describe(menu.items)]))
}

function flatten(entries: readonly MenuEntry[], into: Map<string, { disabled: boolean; checked?: boolean }>): void {
  for (const entry of entries) {
    if (isSeparator(entry) || isRole(entry)) continue
    if (entry.submenu) flatten(entry.submenu, into)
    else into.set(entry.id, { disabled: !!entry.disabled, checked: entry.checked })
  }
}

export function createTauriMenus(appName: string) {
  let queue: Promise<void> = Promise.resolve()
  let structure: string | null = null
  let registry = new Map<string, MenuItem | CheckMenuItem>()
  let states = new Map<string, { disabled: boolean; checked?: boolean }>()
  let handler: (id: string) => void = () => {}

  async function build(menus: readonly AppMenu[]): Promise<void> {
    const next = new Map<string, MenuItem | CheckMenuItem>()
    const select = (id: string) => handler(id)
    const app = await Submenu.new({
      text: appName,
      items: [
        await PredefinedMenuItem.new({ item: { About: null }, text: `关于 ${appName}` }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Services', text: '服务' }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Hide', text: `隐藏 ${appName}` }),
        await PredefinedMenuItem.new({ item: 'HideOthers', text: '隐藏其他' }),
        await PredefinedMenuItem.new({ item: 'ShowAll', text: '全部显示' }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Quit', text: `退出 ${appName}` }),
      ],
    })
    const submenus: Submenu[] = []
    let help: Submenu | null = null
    for (const menu of menus) {
      const submenu = await Submenu.new({ text: menu.label, items: await createEntries(menu.items, select, next) })
      // “帮助”按 macOS 惯例排在“窗口”之后，并作为系统的帮助菜单（带菜单搜索）。
      if (menu.label === '帮助') help = submenu
      else submenus.push(submenu)
    }
    const windowMenu = await Submenu.new({
      text: '窗口',
      items: [
        await PredefinedMenuItem.new({ item: 'Minimize', text: '最小化' }),
        await PredefinedMenuItem.new({ item: 'Maximize', text: '缩放' }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Fullscreen', text: '进入全屏幕' }),
      ],
    })
    const bar = await Menu.new({ items: [app, ...submenus, windowMenu, ...(help ? [help] : [])] })
    await bar.setAsAppMenu()
    await windowMenu.setAsWindowsMenuForNSApp()
    if (help) await help.setAsHelpMenuForNSApp()
    registry = next
  }

  async function apply(menus: readonly AppMenu[]): Promise<void> {
    const nextStructure = structureOf(menus)
    const nextStates = new Map<string, { disabled: boolean; checked?: boolean }>()
    for (const menu of menus) flatten(menu.items, nextStates)
    if (nextStructure !== structure) {
      structure = nextStructure
      states = nextStates
      await build(menus)
      return
    }
    for (const [id, state] of nextStates) {
      const previous = states.get(id)
      const item = registry.get(id)
      if (!item || !previous) continue
      if (previous.disabled !== state.disabled) await item.setEnabled(!state.disabled)
      if (state.checked !== undefined && previous.checked !== state.checked && item instanceof CheckMenuItem) {
        await item.setChecked(state.checked)
      }
    }
    states = nextStates
  }

  return {
    setAppMenu(menus: readonly AppMenu[], onSelect: (id: string) => void): void {
      handler = onSelect
      queue = queue.then(() => apply(menus)).catch(() => {
        // 菜单栏只是另一种入口，更新失败不影响界面中的操作。
      })
    },

    popupMenu(entries: readonly MenuEntry[], at: { x: number; y: number }): Promise<string | null> {
      const run = queue.then(async () => {
        let chosen: string | null = null
        const menu = await Menu.new({ items: await createEntries(entries, (id) => (chosen = id), null) })
        try {
          // macOS 上弹出菜单在关闭前一直阻塞；选择动作的事件可能稍晚于 popup 返回到达。
          await menu.popup(new LogicalPosition(at.x, at.y))
          await new Promise((resolve) => setTimeout(resolve, 30))
          return chosen
        } finally {
          void menu.close().catch(() => {})
        }
      })
      queue = run.then(
        () => {},
        () => {},
      )
      return run.catch(() => null)
    },
  }
}
