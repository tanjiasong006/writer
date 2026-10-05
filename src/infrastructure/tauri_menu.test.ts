import { beforeEach, expect, test, vi } from 'vitest'

/**
 * Tauri 的 popup 在等待主线程显示菜单期间占着菜单资源表；这时再调用 set_enabled 会让应用卡死。
 * 这里用假的菜单 API 记录调用顺序：弹出菜单打开期间，菜单栏的更新必须等它关闭后才执行。
 */
const calls: string[] = []
/** 最近一次设为应用菜单栏的菜单：每个子菜单的文字与其中各项的选项。 */
let appMenu: { text?: string; items: { text?: string; accelerator?: string; item?: unknown }[] }[] = []
let closePopup: () => void = () => {}

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.0' }))
vi.mock('@tauri-apps/api/dpi', () => ({ LogicalPosition: class {} }))
vi.mock('@tauri-apps/api/menu', () => {
  type Options = { id?: string; text?: string; accelerator?: string; item?: unknown; items?: Item[] }
  class Item {
    constructor(readonly options: Options) {}
    static async new(options: Options) {
      return new this(options)
    }
    async setEnabled(enabled: boolean) {
      calls.push(`setEnabled:${this.options.id}:${enabled}`)
    }
    async setChecked() {}
    async close() {}
  }
  class Menu extends Item {
    async setAsAppMenu() {
      appMenu = (this.options.items ?? []).map((submenu) => ({
        text: submenu.options.text,
        items: (submenu.options.items ?? []).map((item) => item.options),
      }))
    }
    popup() {
      calls.push('popup:open')
      return new Promise<void>((resolve) => {
        closePopup = () => {
          calls.push('popup:close')
          resolve()
        }
      })
    }
  }
  class Submenu extends Item {
    async setAsWindowsMenuForNSApp() {}
    async setAsHelpMenuForNSApp() {}
  }
  return { Menu, MenuItem: Item, CheckMenuItem: class extends Item {}, PredefinedMenuItem: Item, Submenu }
})

const { createTauriMenus } = await import('./tauri_menu.ts')

beforeEach(() => {
  calls.length = 0
  appMenu = []
})

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

test('弹出菜单打开期间，菜单栏的更新排在它关闭之后', async () => {
  const menus = createTauriMenus('Writer Dev')
  const bar = (disabled: boolean) => [{ label: '章节', items: [{ id: 'chapter:move-up', label: '上移', disabled }] }]
  menus.setAppMenu(bar(true), () => {})
  await settle()

  const chosen = menus.popupMenu([{ id: 'rename', label: '重命名' }], { x: 10, y: 10 })
  await settle()
  expect(calls).toContain('popup:open')

  menus.setAppMenu(bar(false), () => {}) // 右键同时移动了焦点：菜单栏要更新
  await settle()
  expect(calls.some((call) => call.startsWith('setEnabled'))).toBe(false)

  closePopup()
  await new Promise((resolve) => setTimeout(resolve, 40))
  await settle()
  expect(await chosen).toBeNull()
  expect(calls.indexOf('setEnabled:chapter:move-up:true')).toBeGreaterThan(calls.indexOf('popup:close'))
})

/** 菜单栏的创建要经过几十次异步调用：等到它们全部完成。 */
const built = () => new Promise((resolve) => setTimeout(resolve, 0))

const MENUS = [
  { label: '文件', items: [{ id: 'file:save', label: '保存', shortcut: 'CmdOrCtrl+S' }, { role: 'close-window' as const }] },
  { label: '章节', items: [{ id: 'chapter:move-up', label: '上移', shortcut: 'CmdOrCtrl+ArrowUp' }] },
  { label: '帮助', items: [{ id: 'app:check-update', label: '检查更新…' }] },
]

test('macOS：应用菜单在最前，“帮助”排在“窗口”之后，菜单项注册系统快捷键', async () => {
  createTauriMenus('Writer').setAppMenu(MENUS, () => {})
  await built()
  expect(appMenu.map((menu) => menu.text)).toEqual(['Writer', '文件', '章节', '窗口', '帮助'])
  expect(appMenu[1].items[0]).toMatchObject({ text: '保存', accelerator: 'CmdOrCtrl+S' })
})

test('Windows：没有应用菜单与“窗口”菜单，快捷键只显示在文字右侧，不注册系统快捷键', async () => {
  createTauriMenus('Writer', 'windows').setAppMenu(MENUS, () => {})
  await built()
  expect(appMenu.map((menu) => menu.text)).toEqual(['文件', '章节', '帮助'])
  expect(appMenu[0].items[0]).toMatchObject({ text: '保存\tCtrl+S', accelerator: undefined })
  expect(appMenu[1].items[0].text).toBe('上移\tCtrl+↑')
  // “关于”带名称与版本：Windows 上没有元数据时点击不显示任何内容。
  expect(appMenu[2].items.at(-1)?.item).toEqual({ About: { name: 'Writer', version: '0.1.0' } })
})
