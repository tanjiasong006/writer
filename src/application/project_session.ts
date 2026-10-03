import type { ChapterId, ChapterTree } from '../domain/chapter_tree/chapter_tree.ts'
import {
  replaceTree,
  setContent,
  setDocumentInfo,
  setTitle,
  type DocumentInfo,
  type WriterDocument,
} from '../domain/document/document.ts'
import type { PdfLayoutSettings } from '../domain/pdf_layout/pdf_layout.ts'
import type {
  ImportedAsset,
  ProjectState,
  ProjectStorage,
  StorageFailure,
  StorageResult,
} from './project_storage.ts'

/**
 * 一个已打开项目的编辑会话：持有当前文档与 PDF 排版配置，组织保存。
 *
 * 文档与配置共用 revision 与保存快照：修改配置同样产生 dirty、自动保存与关闭保护；
 * 只改配置时保存不携带任何正文（docs/decisions.md 第 8 节"PDF 配置与项目会话"）。
 *
 * dirty 的边界（docs/decisions.md 第 4 节）：
 * - 每次修改 revision + 1；保存以"发起时的快照"为单位。
 * - 只有存储层返回成功，才把 savedRevision 推进到该快照的 revision。
 * - 保存失败 → 保持 dirty，记录错误；保存期间的新修改 → 保存成功后依然 dirty。
 * - 同一时间最多一个保存在进行，期间的保存请求合并为之后的一次。
 */

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'failed'

export interface ProjectSessionOptions {
  /** 最后一次修改后多久自动保存；null 表示关闭自动保存。 */
  readonly autosaveDelayMs?: number | null
  /** 自动保存失败后多久重试。 */
  readonly retryDelayMs?: number
}

const DEFAULT_AUTOSAVE_DELAY_MS = 1000
const DEFAULT_RETRY_DELAY_MS = 10_000

export class ProjectSession {
  readonly path: string
  private readonly storage: ProjectStorage
  private readonly autosaveDelayMs: number | null
  private readonly retryDelayMs: number

  private current: WriterDocument
  private layout: PdfLayoutSettings
  private revision = 0
  private savedRevision = 0
  /** 磁盘上已确认的正文；用来计算下次保存需要携带哪些章节。 */
  private savedContents: ReadonlyMap<ChapterId, string>
  private error: StorageFailure | null = null
  private inFlight: Promise<boolean> | null = null
  private queued: Promise<boolean> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private readonly listeners = new Set<() => void>()

  /** project 必须是磁盘上已提交的状态（刚打开或刚新建）。 */
  constructor(
    storage: ProjectStorage,
    path: string,
    project: ProjectState,
    options: ProjectSessionOptions = {},
  ) {
    this.storage = storage
    this.path = path
    this.current = project.document
    this.layout = project.pdfLayout
    this.savedContents = project.document.contents
    this.autosaveDelayMs =
      options.autosaveDelayMs === undefined ? DEFAULT_AUTOSAVE_DELAY_MS : options.autosaveDelayMs
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  }

  get document(): WriterDocument {
    return this.current
  }

  /** PDF 排版配置中用户改过的项。 */
  get pdfLayout(): PdfLayoutSettings {
    return this.layout
  }

  get isDirty(): boolean {
    return this.revision !== this.savedRevision
  }

  /** 最近一次保存失败的原因；成功保存后清空。 */
  get lastError(): StorageFailure | null {
    return this.error
  }

  get status(): SaveStatus {
    if (this.inFlight) return 'saving'
    if (!this.isDirty) return 'saved'
    return this.error ? 'failed' : 'dirty'
  }

  /** 订阅任何状态变化（文档、dirty、保存状态）；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 章节结构操作（chapter_tree 用例）之后，用新树更新文档，正文随之同步。
   * restored 是重新出现的章节的正文（撤销删除时），其余新章节的正文为空。
   */
  applyTree(tree: ChapterTree, restored?: ReadonlyMap<ChapterId, string>): void {
    if (tree === this.current.tree) return
    this.commit(replaceTree(this.current, tree, restored))
  }

  /** 修改章节正文；章节不存在时返回 false。 */
  setContent(chapterId: ChapterId, content: string): boolean {
    const result = setContent(this.current, chapterId, content)
    if (!result.ok) return false
    this.commit(result.document)
    return true
  }

  setTitle(title: string): void {
    this.commit(setTitle(this.current, title))
  }

  /** 修改文档信息（标题、副标题、作者）；与当前相同时不产生修改。 */
  setDocumentInfo(info: DocumentInfo): void {
    this.commit(setDocumentInfo(this.current, info))
  }

  /** 替换 PDF 排版配置（由 pdf_layout 的纯函数生成）；与当前相同时不产生修改。 */
  setPdfLayout(settings: PdfLayoutSettings): void {
    if (settings === this.layout) return
    this.layout = settings
    this.changed()
  }

  /** 会话关闭 / 放弃后，等已开始的保存结束再释放存储资源（如独占锁）。 */
  async releaseStorage(): Promise<void> {
    await (this.queued ?? this.inFlight)
    await this.storage.close(this.path)
  }

  /** 正文中资源引用对应的项目内文件路径；项目外或无法解析时返回 null。 */
  assetPath(reference: string): string | null {
    return this.storage.assetPath(this.path, reference)
  }

  /** 把外部图片导入项目资源目录，得到正文可用的引用路径。不改变文档。 */
  importAsset(sourcePath: string): Promise<StorageResult<ImportedAsset>> {
    return this.storage.importAsset(this.path, sourcePath)
  }

  /**
   * 保存当前文档。返回本次（或合并后的那次）保存是否成功提交。
   * 没有未保存的修改时直接成功。
   */
  save(): Promise<boolean> {
    if (this.closed) return Promise.resolve(false)
    this.cancelTimer()
    if (!this.inFlight) return this.startSave()
    // 正在保存：合并为紧随其后的一次保存，它会带上期间的所有修改。
    this.queued ??= this.inFlight.then(() => {
      this.queued = null
      return this.startSave()
    })
    return this.queued
  }

  /** 关闭前调用：停止自动保存，并把未保存的修改尽力提交。返回最终是否已全部保存。 */
  async close(): Promise<boolean> {
    // 正在保存时 save() 会排在其后，保证返回时不再有进行中的保存。
    const saved = (await this.save()) && !this.isDirty
    if (saved) {
      this.closed = true
      this.cancelTimer()
    }
    return saved
  }

  /** 放弃会话（例如用户确认丢弃未保存修改）：停止所有自动保存。 */
  dispose(): void {
    this.closed = true
    this.cancelTimer()
    this.listeners.clear()
  }

  private commit(next: WriterDocument): void {
    if (next === this.current) return
    this.current = next
    this.changed()
  }

  private changed(): void {
    this.revision += 1
    this.schedule(this.autosaveDelayMs)
    this.notify()
  }

  private startSave(): Promise<boolean> {
    // dispose 后不允许启动新保存，包括此前排队、尚未开始的请求。
    if (this.closed) return Promise.resolve(false)
    const run = this.runSave()
    this.inFlight = run
    void run.finally(() => {
      if (this.inFlight === run) this.inFlight = null
      this.notify()
    })
    this.notify()
    return run
  }

  private async runSave(): Promise<boolean> {
    const snapshot = this.current
    const layout = this.layout
    const revision = this.revision
    if (revision === this.savedRevision) return true

    const changed = new Set<ChapterId>()
    for (const [id, text] of snapshot.contents) {
      if (this.savedContents.get(id) !== text) changed.add(id)
    }

    let result: StorageResult<void>
    try {
      result = await this.storage.save(this.path, { document: snapshot, pdfLayout: layout }, changed)
    } catch (error) {
      result = { ok: false, error: { code: 'unknown', message: String(error) } }
    }

    if (result.ok) {
      // 磁盘已提交这份快照：只推进到快照的 revision，期间的新修改仍然是 dirty。
      this.savedRevision = revision
      this.savedContents = snapshot.contents
      this.error = null
      if (this.isDirty) this.schedule(this.autosaveDelayMs)
      return true
    }
    this.error = result.error
    this.schedule(this.autosaveDelayMs === null ? null : this.retryDelayMs)
    return false
  }

  private schedule(delay: number | null): void {
    if (delay === null || this.closed) return
    this.cancelTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.save()
    }, delay)
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
