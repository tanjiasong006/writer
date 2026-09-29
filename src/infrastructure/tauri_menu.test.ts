import { beforeEach, expect, test, vi } from 'vitest'

/**
 * Tauri 的 popup 在等待主线程显示菜单期间占着菜单资源表；这时再调用 set_enabled 会让应用卡死。
 * 这里用假的菜单 API 记录调用顺序：弹出菜单打开期间，菜单栏的更新必须等它关闭后才执行。
 */
const calls: string[] = []
let closePopup: () => void = () => {}

vi.mock('@tauri-apps/api/dpi', () => ({ LogicalPosition: class {} }))
vi.mock('@tauri-apps/api/menu', () => {
  class Item {
    constructor(readonly options: { id?: string; text?: string }) {}
    static async new(options: { id?: string; text?: string }) {
      return new this(options)
    }
    async setEnabled(enabled: boolean) {
      calls.push(`setEnabled:${this.options.id}:${enabled}`)
    }
    async setChecked() {}
    async close() {}
  }
  class Menu extends Item {
    async setAsAppMenu() {}
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
  }
  return { Menu, MenuItem: Item, CheckMenuItem: class extends Item {}, PredefinedMenuItem: Item, Submenu }
})

const { createTauriMenus } = await import('./tauri_menu.ts')

beforeEach(() => {
  calls.length = 0
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
