import type { ProjectStorage } from './project_storage.ts'
import type { DocumentOutput } from './document_output.ts'

/**
 * 菜单项。shortcut 是加速键描述（如 `CmdOrCtrl+B`、`F2`），界面自行换算成显示文字；
 * role 是由系统完成的标准动作（剪切 / 拷贝 / 粘贴 / 全选交给当前焦点处理；关闭窗口走窗口的关闭流程），
 * 名称与快捷键（⌘X、⌘C、⌘V、⌘A、⌘W）由系统提供。
 */
export type MenuEntry =
  | {
      readonly id: string
      readonly label: string
      readonly shortcut?: string
      readonly disabled?: boolean
      /** 勾选项（如"显示侧栏"）；undefined 表示不是勾选项。 */
      readonly checked?: boolean
      readonly submenu?: readonly MenuEntry[]
    }
  | { readonly separator: true }
  | { readonly role: 'cut' | 'copy' | 'paste' | 'select-all' | 'close-window' }

/** 应用菜单栏的一个顶层菜单（文件、编辑……）。应用菜单与窗口菜单由系统实现补上。 */
export interface AppMenu {
  readonly label: string
  readonly items: readonly MenuEntry[]
}

/**
 * 应用需要的桌面能力（对话框、窗口关闭、界面状态）。真实实现基于 Tauri（infrastructure/tauri_services.ts），
 * 测试与 Storybook 使用内存实现（testing/memory_services.ts）。
 */
export interface DesktopShell {
  /**
   * 窗口外观：unified 表示标题栏与工具栏合为一体（macOS），窗口按钮浮在侧栏左上角，
   * 工具栏兼作拖动窗口的区域；standard 是系统的普通标题栏。
   */
  readonly windowStyle: 'unified' | 'standard'
  /**
   * 设置应用菜单栏（只有提供系统菜单栏的平台实现）。以相同的 id 再次调用时只更新可用 / 勾选状态。
   * 选择菜单项时调用 onSelect。
   */
  setAppMenu?(menus: readonly AppMenu[], onSelect: (id: string) => void): void
  /**
   * 在窗口坐标 (x, y) 处弹出系统菜单（右键菜单、按钮菜单），返回选中的 id，关闭时未选择返回 null。
   * 不提供时界面使用自己绘制的菜单。
   */
  popupMenu?(entries: readonly MenuEntry[], at: { readonly x: number; readonly y: number }): Promise<string | null>
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
  /** 把本地文件路径转换成界面可以显示的地址（如编辑器中的图片）。 */
  toDisplayUrl(filePath: string): string
  /** 设置窗口标题（系统标题栏、窗口列表中显示）。失败静默忽略。 */
  setWindowTitle(title: string): void
  /** 应用名称：正式版 "Writer"，开发版 "Writer Dev"（窗口标题、菜单中显示，便于区分）。 */
  readonly appName: string
  /**
   * 应用级状态：上次打开的项目与本机界面偏好。每个应用环境（Writer / Writer Dev）各有一份，互不可见；
   * 启动时已读入，读取是同步的，写入由实现尽力保存。
   */
  getLastProjectPath(): string | null
  setLastProjectPath(path: string | null): void
  getPreference(key: string): string | null
  setPreference(key: string, value: string): void
  /**
   * 启动时要打开的项目（只有开发版提供：环境变量 WRITER_OPEN_PROJECT，供自动化测试打开测试项目）；
   * 提供时优先于上次打开的项目。
   */
  startupProjectPath(): string | null
}

export interface AppServices {
  readonly storage: ProjectStorage
  readonly shell: DesktopShell
  readonly output: DocumentOutput
}
