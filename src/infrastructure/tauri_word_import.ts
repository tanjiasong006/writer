import { open } from '@tauri-apps/plugin-dialog'
import { importDocxProject, type DocumentImporter } from '../application/document_import.ts'
import type { ProjectStorage } from '../application/project_storage.ts'
import type { WordImportPort } from '../ui/app_shell/word_import_port.ts'

/** 系统选择器与应用导入用例之间的适配；项目名只能是单个安全的目录名。 */
export function createTauriWordImport(importer: DocumentImporter, storage: ProjectStorage): WordImportPort {
  return {
    async pickFile() {
      const path = await open({ title: '选择 Word 文档', multiple: false, filters: [{ name: 'Word 文档', extensions: ['docx'] }] })
      return typeof path === 'string' ? path : null
    },
    async pickDirectory() {
      const path = await open({ title: '选择目标目录', directory: true, multiple: false })
      return typeof path === 'string' ? path : null
    },
    async importProject({ filePath, projectName, targetDirectory }) {
      const name = projectName.trim()
      // 同时拒绝 Windows 特殊名称，避免路径在不同平台上产生意外含义。
      if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        return { ok: false, error: { code: 'unknown', message: '项目名称无效' } }
      }
      const windows = /Win/.test(navigator.platform)
      const absolute = windows ? /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(targetDirectory) : targetDirectory.startsWith('/')
      if (!absolute || targetDirectory.includes('\0') || !filePath.trim()) {
        return { ok: false, error: { code: 'unknown', message: '导入路径无效' } }
      }
      const separator = windows ? '\\' : '/'
      const projectPath = targetDirectory.replace(windows ? /[\\/]+$/ : /\/+$/, '') + separator + name
      return importDocxProject(importer, storage, filePath, projectPath, name)
    },
  }
}
