import type { ProjectStorage } from './project_storage.ts'

/**
 * 应用需要的桌面能力（对话框、窗口关闭、界面状态）。真实实现基于 Tauri（infrastructure/tauri_services.ts），
 * 测试与 Storybook 使用内存实现（testing/memory_services.ts）。
 */
export interface DesktopShell {
  /** 让用户选择新项目的位置（目录路径，尚不存在）；取消返回 null。 */
  pickNewProjectPath(): Promise<string | null>
  /** 让用户选择一个已有项目目录；取消返回 null。 */
  pickProjectPath(): Promise<string | null>
  /** 让用户选择一张要插入的图片；取消返回 null。 */
  pickImageFile(): Promise<string | null>
  /** 需要用户明确决定的确认框。 */
  confirm(message: string, labels?: { ok?: string; cancel?: string }): Promise<boolean>
  /**
   * 拦截窗口关闭：handler 返回 true 才真正关闭。返回取消注册函数。
   */
  onCloseRequested(handler: () => Promise<boolean>): () => void
  /** 读取项目的界面状态；不存在或失败返回 null。 */
  loadUiState(projectPath: string): Promise<string | null>
  /** 尽力保存项目的界面状态；失败静默忽略（界面状态丢失不影响文档）。 */
  saveUiState(projectPath: string, state: string): Promise<void>
  getLastProjectPath(): string | null
  setLastProjectPath(path: string | null): void
}

export interface AppServices {
  readonly storage: ProjectStorage
  readonly shell: DesktopShell
}
