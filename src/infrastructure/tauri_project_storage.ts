import { invoke } from '@tauri-apps/api/core'
import type { ChapterId } from '../domain/chapter_tree/chapter_tree.ts'
import { createDocument } from '../domain/document/document.ts'
import type {
  OpenedProject,
  ProjectStorage,
  StorageFailure,
  StorageResult,
} from '../application/project_storage.ts'
import { assetReference, buildManifest, parseManifest } from './project_format/project_format.ts'

/**
 * ProjectStorage 的 Tauri 实现：磁盘事务由 Rust `storage` 模块完成，
 * 这里负责 manifest 的生成、解析，以及把 Rust 返回的外部数据校验后再交给 Domain。
 */
export function createTauriProjectStorage(): ProjectStorage {
  return {
    async create(path, document) {
      const contents = Object.fromEntries(document.contents)
      return call(() =>
        invoke('project_create', { path, request: { manifest: buildManifest(document), contents } }),
      ).then(toVoid)
    },

    async open(path) {
      const result = await call(() => invoke<unknown>('project_open', { path }))
      if (!result.ok) return result
      return decodeOpened(result.value)
    },

    async save(path, document, changed) {
      const contents: Record<ChapterId, string> = {}
      for (const id of changed) {
        const text = document.contents.get(id)
        if (text !== undefined) contents[id] = text
      }
      return call(() =>
        invoke('project_save', { path, request: { manifest: buildManifest(document), contents } }),
      ).then(toVoid)
    },

    async importAsset(path, sourcePath) {
      const result = await call(() => invoke<string>('project_import_asset', { path, source: sourcePath }))
      if (!result.ok) return result
      return { ok: true, value: { fileName: result.value, reference: assetReference(result.value) } }
    },
  }
}

function toVoid(result: StorageResult<unknown>): StorageResult<void> {
  return result.ok ? { ok: true, value: undefined } : result
}

async function call<T>(run: () => Promise<T>): Promise<StorageResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error: toFailure(error) }
  }
}

const KNOWN_CODES = new Set<StorageFailure['code']>([
  'not-a-project',
  'target-not-empty',
  'manifest-invalid',
  'version-unsupported',
  'journal-invalid',
  'content-missing',
  'content-not-utf8',
  'content-required',
  'content-orphan',
  'asset-unsupported',
  'asset-too-large',
  'asset-not-found',
  'io',
])

/** Rust 的 StorageError 序列化为 { code, ...fields }；其余异常（IPC 故障等）归为 unknown。 */
export function toFailure(error: unknown): StorageFailure {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string' && KNOWN_CODES.has(code as StorageFailure['code'])) {
      return error as StorageFailure
    }
  }
  return { code: 'unknown', message: error instanceof Error ? error.message : String(error) }
}

/** 校验 Rust 返回的打开结果，组装成可信的 WriterDocument。 */
export function decodeOpened(raw: unknown): StorageResult<OpenedProject> {
  const invalid = (detail: string): StorageResult<OpenedProject> => ({
    ok: false,
    error: { code: 'manifest-invalid', detail },
  })
  if (typeof raw !== 'object' || raw === null) return invalid('response')
  const { manifest, contents, orphanFiles } = raw as Record<string, unknown>

  const parsed = parseManifest(manifest)
  if (!parsed.ok) return invalid(parsed.issue.code)

  if (typeof contents !== 'object' || contents === null) return invalid('contents')
  const texts = new Map<ChapterId, string>()
  for (const [id, text] of Object.entries(contents)) {
    if (typeof text !== 'string') return invalid('contents')
    texts.set(id, text)
  }

  const document = createDocument(parsed.manifest.title, parsed.manifest.tree, texts)
  if (!document.ok) return invalid(document.reason)

  const orphans = Array.isArray(orphanFiles)
    ? orphanFiles.filter((name): name is string => typeof name === 'string')
    : []
  return { ok: true, value: { document: document.document, orphanFiles: orphans } }
}
