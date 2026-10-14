import type { ProjectStorage } from './project_storage.ts'
import type { DocumentOutput, ExportFormat } from './document_output.ts'

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

/** 检查更新的结果（直接分发的安装包）。 */
export type UpdateCheckResult =
  /** 此版本没有配置更新地址（开发版、自行编译的版本）。 */
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'up-to-date'; readonly current: string }
  | { readonly kind: 'available'; readonly current: string; readonly version: string; readonly notes: string | null }
  /** 网络或服务器问题；message 是原始错误，只在界面上作为补充说明。 */
  | { readonly kind: 'failed'; readonly message: string }

/** 下载安装更新的进度。 */
export type InstallEvent =
  /** 开始从一个地址下载（进度从头开始）；mirror 表示经国内中转站，否则直接从 GitHub。 */
  | { readonly kind: 'download'; readonly mirror: boolean }
  /** 已下载的字节数；total 是总大小（服务器没有给出时为 null）。 */
  | { readonly kind: 'progress'; readonly downloaded: number; readonly total: number | null }
  /** 下载完成并通过签名校验，正在安装。 */
  | { readonly kind: 'installing' }

/** 应用外观：跟随系统，或固定为浅色 / 深色。 */
export type Appearance = 'system' | 'light' | 'dark'

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
  pickExportPath(format: ExportFormat, defaultName: string): Promise<string | null>
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
  /** 设置应用外观（窗口、系统菜单与对话框、界面配色一起切换）。失败静默忽略。 */
  setAppearance(appearance: Appearance): void
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
  /** 窗口进入 / 离开全屏（专注模式）。失败静默忽略；不提供时专注模式不改变窗口。 */
  setFullscreen?(fullscreen: boolean): void
  /** 检查是否有新版本。不提供时（如 Storybook）界面不显示检查更新。 */
  checkForUpdate?(): Promise<UpdateCheckResult>
  /** 下载并安装最近一次检查到的新版本，经 onEvent 通知进度；失败时抛出（原因作为补充说明）。 */
  installUpdate?(onEvent: (event: InstallEvent) => void): Promise<void>
  /** 重新启动应用（安装更新后）。调用前必须已保存并释放当前项目。 */
  restartApp?(): Promise<void>
  /** 在系统文件管理器中打开应用的日志文件夹（帮助 → 显示日志文件夹）。不提供时（如 Storybook）什么都不做。 */
  revealLogFolder?(): Promise<void>
}

export interface AppServices {
  readonly storage: ProjectStorage
  readonly shell: DesktopShell
  readonly output: DocumentOutput
}
