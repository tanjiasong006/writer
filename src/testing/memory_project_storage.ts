import type { ChapterId } from '../domain/chapter_tree/chapter_tree.ts'
import type { WriterDocument } from '../domain/document/document.ts'
import type {
  ImportedAsset,
  OpenedProject,
  ProjectStorage,
  StorageFailure,
  StorageResult,
} from '../application/project_storage.ts'

/**
 * 内存版项目存储，用于测试与 Storybook（没有 Tauri 的环境）。
 *
 * 模拟真实存储的关键语义：未出现在 changed 中的章节，正文保留"磁盘上"已提交的版本。
 * 因此如果调用方漏报了变化的章节，读回的数据会是旧的，测试能发现。
 */
export class MemoryProjectStorage implements ProjectStorage {
  private readonly projects = new Map<string, WriterDocument>()
  private failures: StorageFailure[] = []
  private held: Array<() => void> | null = null
  /** 每次 save 调用的记录。 */
  readonly saves: Array<{ path: string; changed: ReadonlySet<ChapterId> }> = []

  /** 直接放入一个"磁盘上已存在"的项目。 */
  seed(path: string, document: WriterDocument): void {
    this.projects.set(path, document)
  }

  /** 读取"磁盘上"已提交的文档。 */
  committed(path: string): WriterDocument | undefined {
    return this.projects.get(path)
  }

  /** 让接下来的调用依次失败。 */
  failNext(...failures: StorageFailure[]): void {
    this.failures.push(...failures)
  }

  /** 之后的 save 挂起，直到 release()。 */
  hold(): void {
    this.held ??= []
  }

  /** 放行所有挂起的 save，并停止挂起。 */
  release(): void {
    const pending = this.held ?? []
    this.held = null
    for (const resume of pending) resume()
  }

  async create(path: string, document: WriterDocument): Promise<StorageResult<void>> {
    const failure = this.failures.shift()
    if (failure) return { ok: false, error: failure }
    if (this.projects.has(path)) return { ok: false, error: { code: 'target-not-empty' } }
    this.projects.set(path, document)
    return { ok: true, value: undefined }
  }

  async open(path: string): Promise<StorageResult<OpenedProject>> {
    const failure = this.failures.shift()
    if (failure) return { ok: false, error: failure }
    const document = this.projects.get(path)
    if (!document) return { ok: false, error: { code: 'not-a-project' } }
    return { ok: true, value: { document, orphanFiles: [] } }
  }

  /** 导入过的资源：项目路径 → 源路径列表。 */
  readonly importedAssets: Array<{ path: string; sourcePath: string }> = []

  async importAsset(path: string, sourcePath: string): Promise<StorageResult<ImportedAsset>> {
    const failure = this.failures.shift()
    if (failure) return { ok: false, error: failure }
    if (!this.projects.has(path)) return { ok: false, error: { code: 'not-a-project' } }
    this.importedAssets.push({ path, sourcePath })
    const fileName = sourcePath.split(/[\\/]/).pop() ?? 'image.png'
    return { ok: true, value: { fileName, reference: `../assets/${fileName}` } }
  }

  async save(
    path: string,
    document: WriterDocument,
    changed: ReadonlySet<ChapterId>,
  ): Promise<StorageResult<void>> {
    this.saves.push({ path, changed })
    if (this.held) await new Promise<void>((resume) => this.held!.push(resume))
    const failure = this.failures.shift()
    if (failure) return { ok: false, error: failure }

    const previous = this.projects.get(path)
    if (!previous) return { ok: false, error: { code: 'not-a-project' } }
    const contents = new Map<ChapterId, string>()
    for (const [id, text] of document.contents) {
      if (changed.has(id)) contents.set(id, text)
      else {
        const kept = previous.contents.get(id)
        if (kept === undefined) return { ok: false, error: { code: 'content-required', chapterId: id } }
        contents.set(id, kept)
      }
    }
    this.projects.set(path, { ...document, contents })
    return { ok: true, value: undefined }
  }
}
