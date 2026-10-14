import { computed, onBeforeUnmount, shallowRef } from 'vue'
import type { DesktopShell, InstallEvent, UpdateCheckResult } from '../../application/desktop_shell.ts'

/** 更新对话框的状态。 */
export type UpdateState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'up-to-date'; readonly current: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'available'; readonly current: string; readonly version: string; readonly notes: string | null }
  | {
      readonly kind: 'installing'
      readonly version: string
      /** 已下载的字节数与总大小（不知道总大小时为 null）。 */
      readonly downloaded: number
      readonly total: number | null
      /** 经中转站下载失败，正在直接从 GitHub 下载。 */
      readonly direct: boolean
      /** 已下载完成，正在安装。 */
      readonly installing: boolean
    }
  | { readonly kind: 'installed'; readonly version: string }
  | { readonly kind: 'install-failed'; readonly message: string }

/** 下载安装：进行中、已安装（等待重新启动）、失败。对话框关闭后在后台继续。 */
export type InstallTask = Extract<UpdateState, { kind: 'installing' | 'installed' | 'install-failed' }>

/** 顶栏（欢迎页上是浮条）显示的下载安装状态；progress 是 0–1 的下载进度，不知道总大小或不在下载时为 null。 */
export interface InstallStatus {
  readonly label: string
  readonly progress: number | null
}

/** 启动后多久在后台检查一次更新（不与打开文档争抢）。 */
const BACKGROUND_DELAY_MS = 5000

/**
 * 检查更新（直接分发的安装包，docs/decisions.md 第 10 节）。
 *
 * - “帮助 → 检查更新…”：对话框中依次显示检查、结果、下载安装与重新启动。
 * - 启动后在后台静默检查一次：只有发现新版本时才提示，失败、未配置都不打扰。
 *   打开文档时提示是顶栏中常驻的“更新到 x.y.z”（直到安装），点击时重新检查（安装失败后也能再次安装）；
 *   欢迎页上是带“查看”的浮条。
 * - 下载安装时对话框显示进度；关闭对话框（“在后台继续”、Esc）后继续下载安装，顶栏入口显示进度，
 *   点击重新打开对话框。完成后入口提示重新启动；失败时提示一次，查看后回到“更新到 x.y.z”。
 * - 安装阶段（下载完成后替换应用的几秒）不能关闭窗口或退出：拦下并显示对话框。下载阶段可以退出，下载作废。
 * - 重新启动前先保存并释放当前项目（leave 返回 false 表示用户选择留下，不重新启动）。
 */
export function useUpdates(shell: DesktopShell, leave: () => Promise<boolean>) {
  const dialog = shallowRef<UpdateState | null>(null)
  /** 后台检查发现的新版本（欢迎页的浮条中显示）。 */
  const notice = shallowRef<string | null>(null)
  /** 已知可以更新到的版本（顶栏入口）；已是最新或已安装后为 null。 */
  const availableVersion = shallowRef<string | null>(null)
  /** 进行中或刚结束的下载安装；没有时为 null。 */
  const task = shallowRef<InstallTask | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastAvailable: Extract<UpdateState, { kind: 'available' }> | null = null

  const supported = shell.checkForUpdate !== undefined

  async function check(): Promise<void> {
    if (!shell.checkForUpdate) return
    notice.value = null
    // 正在下载安装或等待重新启动时，回到这次更新，而不是重新检查。
    if (task.value) {
      dialog.value = task.value
      return
    }
    dialog.value = { kind: 'checking' }
    const result = await shell.checkForUpdate()
    remember(result)
    if (dialog.value?.kind !== 'checking') return // 检查期间关闭了对话框
    dialog.value = result
  }

  function remember(result: UpdateCheckResult): void {
    if (result.kind === 'available') {
      lastAvailable = result
      availableVersion.value = result.version
    } else if (result.kind === 'up-to-date') {
      lastAvailable = null
      availableVersion.value = null
    }
  }

  /** 后台检查：只有新版本才提示。 */
  function scheduleBackgroundCheck(): void {
    if (!shell.checkForUpdate) return
    timer = setTimeout(async () => {
      timer = null
      const result = await shell.checkForUpdate!()
      remember(result)
      if (result.kind !== 'available' || dialog.value !== null) return
      notice.value = `${shell.appName} ${result.version} 可以更新`
    }, BACKGROUND_DELAY_MS)
  }

  /** 从后台提示打开对话框，显示新版本的说明（或进行中的下载安装）。 */
  function showAvailable(): void {
    notice.value = null
    if (task.value) dialog.value = task.value
    else if (lastAvailable) dialog.value = lastAvailable
  }

  /** 更新下载安装的状态；对话框正显示这次下载安装时一起更新。 */
  function setTask(next: InstallTask | null): void {
    const showing = dialog.value !== null && dialog.value === task.value
    task.value = next
    if (showing) dialog.value = next
  }

  async function install(): Promise<void> {
    const current = dialog.value
    if (current?.kind !== 'available' || !shell.installUpdate) return
    const version = current.version
    let state: Extract<UpdateState, { kind: 'installing' }> = {
      kind: 'installing',
      version,
      downloaded: 0,
      total: null,
      direct: false,
      installing: false,
    }
    task.value = state
    dialog.value = state
    // 经中转站下载失败后改为直接下载时，进度从头开始，并说明原因。
    let mirrorTried = false
    const onEvent = (event: InstallEvent): void => {
      if (task.value !== state) return
      if (event.kind === 'download') {
        state = { ...state, downloaded: 0, total: null, direct: !event.mirror && mirrorTried }
        mirrorTried ||= event.mirror
      } else if (event.kind === 'progress') {
        state = { ...state, downloaded: event.downloaded, total: event.total }
      } else {
        state = { ...state, installing: true }
      }
      setTask(state)
    }
    try {
      await shell.installUpdate(onEvent)
      setTask({ kind: 'installed', version })
      lastAvailable = null
      availableVersion.value = null
    } catch (error) {
      setTask({ kind: 'install-failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function restart(): Promise<void> {
    if (!shell.restartApp) return
    if (!(await leave())) return
    await shell.restartApp()
  }

  /** 正在安装（替换应用）时返回 true 并显示对话框：此时退出可能留下不完整的应用。 */
  function holdWhileInstalling(): boolean {
    const current = task.value
    if (current?.kind !== 'installing' || !current.installing) return false
    dialog.value = current
    return true
  }

  /** 关闭对话框；下载安装中则在后台继续。查看过的安装失败不再在入口提示。 */
  function close(): void {
    if (dialog.value?.kind === 'install-failed' && dialog.value === task.value) task.value = null
    dialog.value = null
  }

  const status = computed<InstallStatus | null>(() => {
    const current = task.value
    if (!current) return null
    switch (current.kind) {
      case 'installing':
        if (current.installing) return { label: '正在安装更新…', progress: null }
        if (current.total === null || current.total <= 0) return { label: '正在下载更新…', progress: null }
        {
          const progress = Math.min(current.downloaded / current.total, 1)
          return { label: `下载更新 ${Math.floor(progress * 100)}%`, progress }
        }
      case 'installed':
        return { label: '重新启动以完成更新', progress: null }
      case 'install-failed':
        return { label: '更新没有完成', progress: null }
    }
    return null
  })

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer)
  })

  return {
    supported,
    dialog,
    notice,
    availableVersion,
    status,
    /** 下载安装在后台进行（或已结束、对话框没有显示它）时为 true：此时由入口显示状态。 */
    inBackground: computed(() => task.value !== null && dialog.value !== task.value),
    check,
    holdWhileInstalling,
    scheduleBackgroundCheck,
    showAvailable,
    install,
    restart,
    close,
    dismissNotice: () => (notice.value = null),
  }
}
