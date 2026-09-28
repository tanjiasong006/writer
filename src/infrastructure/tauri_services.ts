import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ask, open, save } from '@tauri-apps/plugin-dialog'
import type { AppServices, DesktopShell } from '../application/desktop_shell.ts'
import { createTauriProjectStorage } from './tauri_project_storage.ts'
import { createTauriDocumentOutput } from './tauri_document_output.ts'

const LAST_PROJECT_KEY = 'writer.lastProjectPath'

/** 基于 Tauri 的桌面能力。 */
export function createTauriServices(): AppServices {
  return {
    storage: createTauriProjectStorage(),
    shell: createTauriShell(),
    output: createTauriDocumentOutput(),
  }
}

function createTauriShell(): DesktopShell {
  return {
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
      const extension = format === 'docx' ? 'docx' : 'pdf'
      const picked = await save({
        title: format === 'docx' ? '导出 Word' : '导出 PDF',
        defaultPath: `${defaultName}.${extension}`,
        filters: [{ name: format === 'docx' ? 'Word 文档' : 'PDF 文档', extensions: [extension] }],
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
        title: 'Writer',
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

    setWindowTitle(title) {
      void getCurrentWindow()
        .setTitle(title)
        .catch(() => {
          // 标题只是便利，设置失败不影响使用。
        })
    },

    getLastProjectPath() {
      try {
        return localStorage.getItem(LAST_PROJECT_KEY)
      } catch {
        return null
      }
    },

    setLastProjectPath(path) {
      try {
        if (path === null) localStorage.removeItem(LAST_PROJECT_KEY)
        else localStorage.setItem(LAST_PROJECT_KEY, path)
      } catch {
        // 无法记住上次项目不影响使用。
      }
    },
  }
}
