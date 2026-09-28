import type { ChapterId, ChapterTree } from '../domain/chapter_tree/chapter_tree.ts'
import {
  replaceTree,
  setContent,
  setTitle,
  type WriterDocument,
} from '../domain/document/document.ts'
import type {
  ImportedAsset,
  ProjectStorage,
  StorageFailure,
  StorageResult,
} from './project_storage.ts'

/**
 * 一个已打开项目的编辑会话：持有当前文档，组织保存。
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

  /** document 必须是磁盘上已提交的状态（刚打开或刚新建）。 */
  constructor(
    storage: ProjectStorage,
    path: string,
    document: WriterDocument,
    options: ProjectSessionOptions = {},
  ) {
    this.storage = storage
    this.path = path
    this.current = document
    this.savedContents = document.contents
    this.autosaveDelayMs =
      options.autosaveDelayMs === undefined ? DEFAULT_AUTOSAVE_DELAY_MS : options.autosaveDelayMs
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  }

  get document(): WriterDocument {
    return this.current
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

  /** 章节结构操作（chapter_tree 用例）之后，用新树更新文档，正文随之同步。 */
  applyTree(tree: ChapterTree): void {
    if (tree === this.current.tree) return
    this.commit(replaceTree(this.current, tree))
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

  /** 把外部图片导入项目资源目录，得到正文可用的引用路径。不改变文档。 */
  importAsset(sourcePath: string): Promise<StorageResult<ImportedAsset>> {
    return this.storage.importAsset(this.path, sourcePath)
  }

  /**
   * 保存当前文档。返回本次（或合并后的那次）保存是否成功提交。
   * 没有未保存的修改时直接成功。
   */
  save(): Promise<boolean> {
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
    this.revision += 1
    this.schedule(this.autosaveDelayMs)
    this.notify()
  }

  private startSave(): Promise<boolean> {
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
    const revision = this.revision
    if (revision === this.savedRevision) return true

    const changed = new Set<ChapterId>()
    for (const [id, text] of snapshot.contents) {
      if (this.savedContents.get(id) !== text) changed.add(id)
    }

    let result: StorageResult<void>
    try {
      result = await this.storage.save(this.path, snapshot, changed)
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
