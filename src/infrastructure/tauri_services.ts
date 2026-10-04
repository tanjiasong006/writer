import { setTheme } from '@tauri-apps/api/app'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ask, open, save } from '@tauri-apps/plugin-dialog'
import type { AppServices, DesktopShell, UpdateCheckResult } from '../application/desktop_shell.ts'
import type { ExportFormat } from '../application/document_output.ts'
import { createTauriProjectStorage } from './tauri_project_storage.ts'
import { createTauriDocumentOutput } from './tauri_document_output.ts'
import { createTauriMenus } from './tauri_menu.ts'
import { loadAppState } from './tauri_app_state.ts'

/** 基于 Tauri 的桌面能力。启动时先读入应用环境与应用级状态（见 tauri_app_state.ts）。 */
export async function createTauriServices(): Promise<AppServices> {
  return {
    storage: createTauriProjectStorage(),
    shell: createTauriShell(await loadAppState()),
    output: createTauriDocumentOutput(),
  }
}

function createTauriShell(appState: Awaited<ReturnType<typeof loadAppState>>): DesktopShell {
  // macOS：标题栏与工具栏合一（tauri.conf.json 的 titleBarStyle: Overlay），命令同时出现在系统菜单栏中。
  // 其他平台使用系统标题栏；应用内的工具栏与菜单提供全部命令。
  const mac = /Mac/.test(navigator.platform)
  const appName = appState.snapshot.appName
  const menus = createTauriMenus(appName)
  return {
    appName,
    windowStyle: mac ? 'unified' : 'standard',
    setAppMenu: mac ? menus.setAppMenu : undefined,
    popupMenu: menus.popupMenu,

    async pickNewProjectPath() {
      return save({ title: '新建文档', defaultPath: '未命名文档' })
    },

    async pickProjectPath() {
      const picked = await open({ title: '打开文档', directory: true, multiple: false })
      return typeof picked === 'string' ? picked : null
    },

    async pickImageFile() {
      const picked = await open({
        title: '插入图片',
        multiple: false,
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
      })
      return typeof picked === 'string' ? picked : null
    },

    async pickExportPath(format, defaultName) {
      const { extension, title, kind } = EXPORT_FILES[format]
      const picked = await save({
        title,
        defaultPath: `${defaultName}.${extension}`,
        filters: [{ name: kind, extensions: [extension] }],
      })
      if (picked === null) return null
      return picked.toLowerCase().endsWith(`.${extension}`) ? picked : `${picked}.${extension}`
    },

    async revealFile(filePath) {
      try {
        await invoke('reveal_in_file_manager', { path: filePath })
      } catch {
        // 打不开文件管理器不影响导出结果。
      }
    },

    async confirm(message, labels) {
      return ask(message, {
        title: appName,
        kind: 'warning',
        okLabel: labels?.ok ?? '确定',
        cancelLabel: labels?.cancel ?? '取消',
      })
    },

    onCloseRequested(handler) {
      let disposed = false
      let unlisten: (() => void) | null = null
      // Tauri 会等待回调结束；未 preventDefault 时随后销毁窗口。
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (!(await handler())) event.preventDefault()
        })
        .then((stop) => {
          if (disposed) stop()
          else unlisten = stop
        })
      return () => {
        disposed = true
        unlisten?.()
      }
    },

    async loadUiState(projectPath) {
      try {
        return await invoke<string | null>('project_read_ui_state', { path: projectPath })
      } catch {
        return null
      }
    },

    async saveUiState(projectPath, state) {
      try {
        await invoke('project_write_ui_state', { path: projectPath, state })
      } catch {
        // 界面状态只是便利，写入失败不打扰用户。
      }
    },

    toDisplayUrl(filePath) {
      return convertFileSrc(filePath)
    },

    setAppearance(appearance) {
      // 应用级主题：窗口、系统菜单与对话框跟着切换，网页的 prefers-color-scheme 随之改变（ui/tokens.css）。
      void setTheme(appearance === 'system' ? null : appearance).catch(() => {
        // 外观只是偏好，设置失败时保持当前外观。
      })
    },

    setFullscreen(fullscreen) {
      void getCurrentWindow()
        .setFullscreen(fullscreen)
        .catch(() => {
          // 全屏只是专注模式的一部分，失败时仍可在窗口中专注写作。
        })
    },

    setWindowTitle(title) {
      void getCurrentWindow()
        .setTitle(title)
        .catch(() => {
          // 标题只是便利，设置失败不影响使用。
        })
    },

    getLastProjectPath: appState.getLastProjectPath,
    setLastProjectPath: appState.setLastProjectPath,
    getPreference: appState.getPreference,
    setPreference: appState.setPreference,
    startupProjectPath: () => appState.snapshot.openProject,

    async checkForUpdate() {
      try {
        return await invoke<UpdateCheckResult>('update_check')
      } catch (error) {
        return { kind: 'failed', message: errorMessage(error) }
      }
    },

    async installUpdate() {
      try {
        await invoke('update_install')
      } catch (error) {
        throw new Error(errorMessage(error))
      }
    },

    async restartApp() {
      await invoke('app_restart')
    },
  }
}

/** 各导出格式的扩展名与保存对话框中的文字。 */
const EXPORT_FILES: Readonly<Record<ExportFormat, { extension: string; title: string; kind: string }>> = {
  docx: { extension: 'docx', title: '导出 Word', kind: 'Word 文档' },
  pdf: { extension: 'pdf', title: '导出 PDF', kind: 'PDF 文档' },
  markdown: { extension: 'md', title: '导出 Markdown', kind: 'Markdown 文档' },
  html: { extension: 'html', title: '导出 HTML', kind: 'HTML 网页' },
  epub: { extension: 'epub', title: '导出 EPUB', kind: 'EPUB 电子书' },
}

/** Rust 返回的错误（{ message }）或其他异常的说明文字。 */
function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}
