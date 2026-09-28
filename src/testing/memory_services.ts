import type { AppServices, DesktopShell } from '../application/desktop_shell.ts'
import { MemoryProjectStorage } from './memory_project_storage.ts'

/** 内存版桌面能力：对话框结果、确认框答案由测试 / Story 预先设定。 */
export class MemoryShell implements DesktopShell {
  newProjectPath: string | null = null
  projectPath: string | null = null
  imagePath: string | null = null
  confirmAnswer = true
  readonly confirmations: string[] = []
  readonly uiStates = new Map<string, string>()
  lastProjectPath: string | null = null
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

  getLastProjectPath() {
    return this.lastProjectPath
  }

  setLastProjectPath(path: string | null) {
    this.lastProjectPath = path
  }
}

export function createMemoryServices(): AppServices & {
  storage: MemoryProjectStorage
  shell: MemoryShell
} {
  return { storage: new MemoryProjectStorage(), shell: new MemoryShell() }
}
