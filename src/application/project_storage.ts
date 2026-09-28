import type { ChapterId } from '../domain/chapter_tree/chapter_tree.ts'
import type { WriterDocument } from '../domain/document/document.ts'

/**
 * 项目存储端口：Application 需要的外部能力。具体实现（Tauri + Rust）在 infrastructure。
 * 格式与一致性规则见 docs/project-format.md。
 */

/** 文件系统错误的分类（与 Rust io_kind 一致）。 */
export type IoKind = 'permission-denied' | 'read-only' | 'disk-full' | 'not-found' | 'busy' | 'other'

/** 存储失败的机器可读原因；面向用户的文案由 UI 层根据 code 生成。 */
export type StorageFailure =
  | { readonly code: 'not-a-project' }
  | { readonly code: 'target-not-empty' }
  | { readonly code: 'manifest-invalid'; readonly detail?: string }
  | { readonly code: 'version-unsupported' }
  | { readonly code: 'journal-invalid' }
  | { readonly code: 'content-missing'; readonly chapterId: ChapterId; readonly file: string }
  | { readonly code: 'content-not-utf8'; readonly chapterId: ChapterId; readonly file: string }
  | { readonly code: 'content-required'; readonly chapterId: ChapterId }
  | { readonly code: 'content-orphan'; readonly chapterId: ChapterId }
  | { readonly code: 'project-locked' }
  | { readonly code: 'asset-unsupported' }
  | { readonly code: 'asset-too-large' }
  | { readonly code: 'asset-not-found' }
  | {
      readonly code: 'io'
      readonly operation: string
      readonly path: string
      /** 错误分类；缺失时按 other 处理。 */
      readonly kind?: IoKind
      /** 操作系统的原始错误文本，只在无法分类时展示。 */
      readonly message: string
    }
  | { readonly code: 'unknown'; readonly message: string }

export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: StorageFailure }

export interface OpenedProject {
  readonly document: WriterDocument
  /** content/ 中未被引用的文件，仅用于提示，不影响打开。 */
  readonly orphanFiles: readonly string[]
}

export interface ProjectStorage {
  /** 在不存在或为空的目录中新建项目，写入文档的全部内容。 */
  create(path: string, document: WriterDocument): Promise<StorageResult<void>>
  open(path: string): Promise<StorageResult<OpenedProject>>
  /**
   * 把文档完整提交到磁盘。changed 是自上次成功保存后正文发生变化的章节（含新章节）；
   * 其余章节的正文由存储层从磁盘保留（编号变化时按字节换名）。
   * 只有返回 ok: true 才表示已提交。
   */
  save(
    path: string,
    document: WriterDocument,
    changed: ReadonlySet<ChapterId>,
  ): Promise<StorageResult<void>>
  /**
   * 把外部图片复制进项目资源目录，返回正文中引用它的相对路径（如 ../assets/图.png）。
   * 资源独立于保存事务：复制成功即落盘，不影响文档 dirty 状态。
   */
  importAsset(path: string, sourcePath: string): Promise<StorageResult<ImportedAsset>>
  /** 正文中的资源引用（如 ../assets/图.png）对应的项目内文件路径；项目外或无法解析时返回 null。 */
  assetPath(path: string, reference: string): string | null
  /** 关闭项目，释放打开时取得的独占锁（同一项目同一时间只能被一个 Writer 打开）。尽力而为。 */
  close(path: string): Promise<void>
}

export interface ImportedAsset {
  /** 正文 Markdown 中引用该资源的相对路径。 */
  readonly reference: string
  /** 资源在项目中的文件名。 */
  readonly fileName: string
}
