import type { ProjectStorage } from './project_storage.ts'
import type { DocumentOutput } from './document_output.ts'

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
  /**
   * 让用户选择导出文件的保存位置；取消返回 null。
   * defaultName 不含扩展名，扩展名由 format 决定。
   */
  pickExportPath(format: 'docx' | 'pdf', defaultName: string): Promise<string | null>
  /** 在系统文件管理器中显示文件。失败静默忽略。 */
  revealFile(filePath: string): Promise<void>
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
  /** 把本地文件路径转换成界面可以显示的地址（如预览中的图片）。 */
  toDisplayUrl(filePath: string): string
  /** 设置窗口标题（系统标题栏、窗口列表中显示）。失败静默忽略。 */
  setWindowTitle(title: string): void
  getLastProjectPath(): string | null
  setLastProjectPath(path: string | null): void
}

export interface AppServices {
  readonly storage: ProjectStorage
  readonly shell: DesktopShell
  readonly output: DocumentOutput
}
