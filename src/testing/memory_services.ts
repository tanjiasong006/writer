import type { AppMenu, AppServices, DesktopShell } from '../application/desktop_shell.ts'
import { MemoryProjectStorage } from './memory_project_storage.ts'
import { MemoryDocumentOutput } from './memory_document_output.ts'

/** 内存版桌面能力：对话框结果、确认框答案由测试 / Story 预先设定。 */
export class MemoryShell implements DesktopShell {
  /** Story 可以设为 unified 查看 macOS 合一标题栏的布局。 */
  windowStyle: 'unified' | 'standard' = 'standard'
  /** 最近一次设置的菜单栏；null 表示没有系统菜单栏（与 Windows 相同）。测试用 enableAppMenu 打开。 */
  appMenus: readonly AppMenu[] | null = null
  private menuHandler: ((id: string) => void) | null = null
  setAppMenu?: (menus: readonly AppMenu[], onSelect: (id: string) => void) => void

  /** 模拟提供系统菜单栏的平台（macOS）。 */
  enableAppMenu(): void {
    this.setAppMenu = (menus, onSelect) => {
      this.appMenus = menus
      this.menuHandler = onSelect
    }
  }

  /** 模拟在菜单栏中选择一项。 */
  chooseMenuItem(id: string): void {
    this.menuHandler?.(id)
  }

  newProjectPath: string | null = null
  projectPath: string | null = null
  imagePath: string | null = null
  exportPath: string | null = null
  readonly revealed: string[] = []
  confirmAnswer = true
  readonly confirmations: string[] = []
  readonly uiStates = new Map<string, string>()
  lastProjectPath: string | null = null
  readonly appName = 'Writer'
  readonly preferences = new Map<string, string>()
  /** 模拟开发版的 WRITER_OPEN_PROJECT。 */
  startupProject: string | null = null
  windowTitle = 'Writer'
  closeHandler: (() => Promise<boolean>) | null = null

  async pickNewProjectPath() {
    return this.newProjectPath
  }

  async pickProjectPath() {
    return this.projectPath
  }

  async pickImageFile() {
    return this.imagePath
  }

  async pickExportPath() {
    return this.exportPath
  }

  async revealFile(filePath: string) {
    this.revealed.push(filePath)
  }

  async confirm(message: string) {
    this.confirmations.push(message)
    return this.confirmAnswer
  }

  onCloseRequested(handler: () => Promise<boolean>) {
    this.closeHandler = handler
    return () => {
      if (this.closeHandler === handler) this.closeHandler = null
    }
  }

  /** 模拟用户点击窗口关闭按钮，返回窗口是否真的关闭。 */
  async requestClose(): Promise<boolean> {
    return this.closeHandler ? this.closeHandler() : true
  }

  async loadUiState(projectPath: string) {
    return this.uiStates.get(projectPath) ?? null
  }

  async saveUiState(projectPath: string, state: string) {
    this.uiStates.set(projectPath, state)
  }

  toDisplayUrl(filePath: string) {
    return `file://${filePath}`
  }

  setWindowTitle(title: string) {
    this.windowTitle = title
  }

  getLastProjectPath() {
    return this.lastProjectPath
  }

  setLastProjectPath(path: string | null) {
    this.lastProjectPath = path
  }

  getPreference(key: string) {
    return this.preferences.get(key) ?? null
  }

  setPreference(key: string, value: string) {
    this.preferences.set(key, value)
  }

  startupProjectPath() {
    return this.startupProject
  }
}

export function createMemoryServices(): AppServices & {
  storage: MemoryProjectStorage
  shell: MemoryShell
  output: MemoryDocumentOutput
} {
  return {
    storage: new MemoryProjectStorage(),
    shell: new MemoryShell(),
    output: new MemoryDocumentOutput(),
  }
}
