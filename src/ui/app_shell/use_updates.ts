import { onBeforeUnmount, shallowRef } from 'vue'
import type { DesktopShell } from '../../application/desktop_shell.ts'

/** 更新对话框的状态。 */
export type UpdateState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'up-to-date'; readonly current: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'available'; readonly current: string; readonly version: string; readonly notes: string | null }
  | { readonly kind: 'installing'; readonly version: string }
  | { readonly kind: 'installed'; readonly version: string }
  | { readonly kind: 'install-failed'; readonly message: string }

/** 启动后多久在后台检查一次更新（不与打开文档争抢）。 */
const BACKGROUND_DELAY_MS = 5000

/**
 * 检查更新（直接分发的安装包，docs/decisions.md 第 10 节）。
 *
 * - “帮助 → 检查更新…”：对话框中依次显示检查、结果、下载安装与重新启动。
 * - 启动后在后台静默检查一次：只有发现新版本时才提示（带“查看”），失败、未配置都不打扰。
 * - 重新启动前先保存并释放当前项目（leave 返回 false 表示用户选择留下，不重新启动）。
 */
export function useUpdates(shell: DesktopShell, leave: () => Promise<boolean>) {
  const dialog = shallowRef<UpdateState | null>(null)
  /** 后台检查发现的新版本（提示中显示）。 */
  const notice = shallowRef<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastAvailable: Extract<UpdateState, { kind: 'available' }> | null = null

  const supported = shell.checkForUpdate !== undefined

  async function check(): Promise<void> {
    if (!shell.checkForUpdate) return
    notice.value = null
    dialog.value = { kind: 'checking' }
    const result = await shell.checkForUpdate()
    if (dialog.value?.kind !== 'checking') return // 检查期间关闭了对话框
    if (result.kind === 'available') lastAvailable = result
    dialog.value = result
  }

  /** 后台检查：只有新版本才提示。 */
  function scheduleBackgroundCheck(): void {
    if (!shell.checkForUpdate) return
    timer = setTimeout(async () => {
      timer = null
      const result = await shell.checkForUpdate!()
      if (result.kind !== 'available' || dialog.value !== null) return
      lastAvailable = result
      notice.value = `${shell.appName} ${result.version} 可以更新`
    }, BACKGROUND_DELAY_MS)
  }

  /** 从后台提示打开对话框，显示新版本的说明。 */
  function showAvailable(): void {
    notice.value = null
    if (lastAvailable) dialog.value = lastAvailable
  }

  async function install(): Promise<void> {
    const current = dialog.value
    if (current?.kind !== 'available' || !shell.installUpdate) return
    dialog.value = { kind: 'installing', version: current.version }
    try {
      await shell.installUpdate()
      dialog.value = { kind: 'installed', version: current.version }
    } catch (error) {
      dialog.value = { kind: 'install-failed', message: error instanceof Error ? error.message : String(error) }
    }
  }

  async function restart(): Promise<void> {
    if (!shell.restartApp) return
    if (!(await leave())) return
    await shell.restartApp()
  }

  function close(): void {
    // 下载安装进行中不能关闭：安装中途退出可能留下不完整的应用。
    if (dialog.value?.kind === 'installing') return
    dialog.value = null
  }

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer)
  })

  return {
    supported,
    dialog,
    notice,
    check,
    scheduleBackgroundCheck,
    showAvailable,
    install,
    restart,
    close,
    dismissNotice: () => (notice.value = null),
  }
}
