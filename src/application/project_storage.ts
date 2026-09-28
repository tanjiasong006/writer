import type { ChapterId } from '../domain/chapter_tree/chapter_tree.ts'
import type { WriterDocument } from '../domain/document/document.ts'

/**
 * 项目存储端口：Application 需要的外部能力。具体实现（Tauri + Rust）在 infrastructure。
 * 格式与一致性规则见 docs/project-format.md。
 */

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
  | { readonly code: 'io'; readonly operation: string; readonly path: string; readonly message: string }
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
}
