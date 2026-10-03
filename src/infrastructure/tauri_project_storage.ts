import { invoke } from '@tauri-apps/api/core'
import type { ChapterId } from '../domain/chapter_tree/chapter_tree.ts'
import { createDocument, setDocumentInfo, setReferences } from '../domain/document/document.ts'
import type {
  OpenedProject,
  ProjectStorage,
  StorageFailure,
  StorageResult,
} from '../application/project_storage.ts'
import {
  assetReference,
  buildManifest,
  parseManifest,
  resolveAssetReference,
} from './project_format/project_format.ts'

/**
 * ProjectStorage 的 Tauri 实现：磁盘事务由 Rust `storage` 模块完成，
 * 这里负责 manifest 的生成、解析，以及把 Rust 返回的外部数据校验后再交给 Domain。
 */
export function createTauriProjectStorage(): ProjectStorage {
  return {
    async create(path, { document, pdfLayout }) {
      const contents = Object.fromEntries(document.contents)
      const manifest = buildManifest(document, pdfLayout)
      return call(() => invoke('project_create', { path, request: { manifest, contents } })).then(toVoid)
    },

    async open(path) {
      const result = await call(() => invoke<unknown>('project_open', { path }))
      if (!result.ok) return result
      const decoded = decodeOpened(result.value)
      if (!decoded.ok) {
        // Rust 已持有项目锁；前端拒绝这份数据时也必须结束后端的打开流程。
        // 释放失败仍返回原始校验错误，进程退出时操作系统会释放锁。
        await call(() => invoke<void>('project_close', { path }))
      }
      return decoded
    },

    async save(path, { document, pdfLayout }, changed) {
      const contents: Record<ChapterId, string> = {}
      for (const id of changed) {
        const text = document.contents.get(id)
        if (text !== undefined) contents[id] = text
      }
      const manifest = buildManifest(document, pdfLayout)
      return call(() => invoke('project_save', { path, request: { manifest, contents } })).then(toVoid)
    },

    async close(path) {
      try {
        await invoke('project_close', { path })
      } catch {
        // 释放失败时，进程退出时操作系统也会释放锁。
      }
    },

    async importAsset(path, sourcePath) {
      const result = await call(() => invoke<string>('project_import_asset', { path, source: sourcePath }))
      if (!result.ok) return result
      return { ok: true, value: { fileName: result.value, reference: assetReference(result.value) } }
    },

    async importAssetData(path, fileName, data) {
      const result = await call(() =>
        invoke<string>('project_import_asset_data', data, {
          headers: { 'writer-project': encodeURIComponent(path), 'writer-file-name': encodeURIComponent(fileName) },
        }),
      )
      if (!result.ok) return result
      return { ok: true, value: { fileName: result.value, reference: assetReference(result.value) } }
    },

    assetPath(path, reference) {
      return resolveAssetReference(path, reference)
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
  'project-locked',
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

  const { info, references, pdfLayout, tree } = parsed.manifest
  const document = createDocument(info.title, tree, texts)
  if (!document.ok) return invalid(document.reason)

  const orphans = Array.isArray(orphanFiles)
    ? orphanFiles.filter((name): name is string => typeof name === 'string')
    : []
  return {
    ok: true,
    value: {
      document: setReferences(setDocumentInfo(document.document, info), references),
      pdfLayout,
      orphanFiles: orphans,
    },
  }
}
