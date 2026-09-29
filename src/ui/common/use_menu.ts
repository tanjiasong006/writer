import { inject, nextTick, onBeforeUnmount, shallowRef } from 'vue'
import type { MenuEntry } from '../../application/desktop_shell.ts'
import { APP_SERVICES } from '../services.ts'
import type { MenuAnchor } from './PopupMenu.vue'

/**
 * 打开一个菜单（右键菜单、按钮菜单），等待用户选择。
 *
 * 桌面环境提供系统菜单时使用系统菜单：外观、键盘操作（方向键、键入首字母）、辅助功能都与系统一致，
 * 剪切 / 拷贝 / 粘贴由系统直接交给当前焦点。没有系统菜单时（Storybook、测试）由组件渲染 PopupMenu：
 * `current` 不为 null 时渲染，选择或关闭时调用 `select` / `close`。
 *
 * 同一时间只有一个菜单；在它关闭前再次打开会先以"未选择"结束前一个。
 */
export interface OpenMenu {
  readonly entries: readonly MenuEntry[]
  readonly anchor: MenuAnchor
  readonly keyboard: boolean
}

/** 与 PopupMenu 相同：菜单在按钮下方留出的间距。 */
const GAP = 4

function pointOf(anchor: MenuAnchor): { x: number; y: number } {
  if ('rect' in anchor) return { x: anchor.rect.left, y: anchor.rect.bottom + GAP }
  return { x: anchor.x, y: anchor.y }
}

const ROLE_COMMANDS: Readonly<Record<string, string>> = {
  'role:cut': 'cut',
  'role:copy': 'copy',
  'role:select-all': 'selectAll',
}

/** 界面绘制的菜单中选择了标准编辑动作：菜单关闭、焦点回到原处后由浏览器对当前焦点执行。 */
function runRole(id: string): boolean {
  const command = ROLE_COMMANDS[id]
  if (command === undefined) return false
  void nextTick(() => document.execCommand(command))
  return true
}

export function useMenu() {
  const shell = inject(APP_SERVICES, null)?.shell ?? null
  const current = shallowRef<OpenMenu | null>(null)
  let resolveCurrent: ((id: string | null) => void) | null = null

  function finish(id: string | null): void {
    const resolve = resolveCurrent
    resolveCurrent = null
    current.value = null
    resolve?.(id)
  }

  /** 打开菜单，返回选中的 id；关闭时未选择返回 null。 */
  function open(entries: readonly MenuEntry[], anchor: MenuAnchor, keyboard = false): Promise<string | null> {
    finish(null)
    if (shell?.popupMenu) return shell.popupMenu(entries, pointOf(anchor))
    return new Promise((resolve) => {
      resolveCurrent = resolve
      current.value = { entries, anchor, keyboard }
    })
  }

  function select(id: string): void {
    if (runRole(id)) finish(null)
    else finish(id)
  }

  onBeforeUnmount(() => finish(null))

  return { current, open, select, close: () => finish(null) }
}
