import {
  validateTree,
  type ChapterId,
  type ChapterTree,
  type TreeIssue,
} from '../../domain/chapter_tree/chapter_tree.ts'
import {
  computeChapterNumbers,
  type ChapterNumber,
} from '../../domain/chapter_numbering/chapter_numbering.ts'
import type { WriterDocument } from '../../domain/document/document.ts'

/**
 * Writer 项目 manifest（writer.json）的生成与解析。
 * 格式定义见 docs/project-format.md；本模块是 TS 侧唯一知道该格式的地方。
 */

export const MANIFEST_FORMAT = 'writer-project'
export const MANIFEST_VERSION = 1

/** 写入 writer.json 的 JSON 结构。 */
export interface Manifest {
  readonly format: typeof MANIFEST_FORMAT
  readonly version: typeof MANIFEST_VERSION
  readonly title: string
  readonly chapters: ChapterTree
  /** ChapterId → 当前正文文件名（相对 content/）。 */
  readonly files: Readonly<Record<ChapterId, string>>
}

/** 正文文件名格式：ch_ + 各级编号（从 1 开始、无前导 0）以 _ 连接 + .md。 */
const CONTENT_FILE_PATTERN = /^ch_[1-9]\d*(?:_[1-9]\d*)*\.md$/

/** 由章节编号得到正文文件名，如 [2, 1] → ch_2_1.md。 */
export function contentFileName(number: ChapterNumber): string {
  return `ch_${number.join('_')}.md`
}

export function isContentFileName(name: string): boolean {
  return CONTENT_FILE_PATTERN.test(name)
}

/** 按当前章节编号推导每个章节应使用的正文文件名。 */
export function contentFiles(tree: ChapterTree): ReadonlyMap<ChapterId, string> {
  const files = new Map<ChapterId, string>()
  for (const [id, number] of computeChapterNumbers(tree)) files.set(id, contentFileName(number))
  return files
}

/** 正文文件位于 content/，资源位于 assets/，因此正文中以 ../assets/<name> 引用资源。 */
export function assetReference(fileName: string): string {
  return `../assets/${fileName}`
}

/**
 * 正文中的图片引用（相对 content/，可含 %XX 编码）对应的项目内文件路径。
 * 远程地址、data URI、绝对路径、非法编码、以及跳出项目目录的引用返回 null。
 * 与 Rust `render::resolve_image` 规则一致（Rust 另外比较规范化路径以防符号链接逃逸）。
 */
export function resolveAssetReference(projectPath: string, reference: string): string | null {
  const parts = projectRelativeParts(reference)
  if (parts === null) return null
  const separator = projectPath.includes('\\') && !projectPath.includes('/') ? '\\' : '/'
  return [projectPath.replace(/[\\/]+$/, ''), ...parts].join(separator)
}

/** 引用指向的文件相对项目根目录的路径各段（如 ../assets/图.png → assets、图.png）。 */
function projectRelativeParts(reference: string): string[] | null {
  if (reference.length === 0 || reference.includes('://') || reference.startsWith('data:')) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(reference)
  } catch {
    return null
  }
  if (/^([\\/]|[A-Za-z]:)/.test(decoded)) return null
  const parts = ['content']
  for (const part of decoded.split(/[\\/]/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.length === 0 ? null : parts
}

/**
 * 由文档生成 manifest；文件名总是按当前编号重新推导。
 * 只写出已定义的字段：读取时忽略的额外字段（如旧版的 style）不会再被写出。
 */
export function buildManifest(document: WriterDocument): Manifest {
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    title: document.title,
    chapters: document.tree,
    files: Object.fromEntries(contentFiles(document.tree)),
  }
}

export type ManifestIssue =
  | { readonly code: 'not-an-object' }
  | { readonly code: 'format-unknown' }
  | { readonly code: 'version-unsupported'; readonly version: unknown }
  | { readonly code: 'title-invalid' }
  | { readonly code: 'tree-invalid'; readonly issues: readonly TreeIssue[] }
  | { readonly code: 'files-invalid' }
  | { readonly code: 'file-name-invalid'; readonly chapterId: ChapterId }
  | { readonly code: 'file-duplicate'; readonly chapterId: ChapterId }
  | { readonly code: 'file-missing'; readonly chapterId: ChapterId }
  | { readonly code: 'file-orphan'; readonly chapterId: ChapterId }

export interface ParsedManifest {
  readonly title: string
  readonly tree: ChapterTree
  readonly files: ReadonlyMap<ChapterId, string>
}

export type ParseManifestResult =
  | { readonly ok: true; readonly manifest: ParsedManifest }
  | { readonly ok: false; readonly issue: ManifestIssue }

/**
 * 在信任边界上校验 manifest。输入是 JSON.parse 的结果（unknown）。
 * 通过后返回可信的章节树与文件对应关系；文件名不要求等于按编号推导的名字，
 * 下一次保存会把它们整理成规范名字。未定义的额外字段（包括已取消的 style）不读取、不校验。
 */
export function parseManifest(raw: unknown): ParseManifestResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail({ code: 'not-an-object' })
  }
  const m = raw as Record<string, unknown>

  if (m.format !== MANIFEST_FORMAT) return fail({ code: 'format-unknown' })
  if (m.version !== MANIFEST_VERSION) return fail({ code: 'version-unsupported', version: m.version })
  if (typeof m.title !== 'string') return fail({ code: 'title-invalid' })

  const tree = validateTree(m.chapters)
  if (!tree.ok) return fail({ code: 'tree-invalid', issues: tree.issues })

  if (typeof m.files !== 'object' || m.files === null || Array.isArray(m.files)) {
    return fail({ code: 'files-invalid' })
  }
  const rawFiles = m.files as Record<string, unknown>

  const ids = new Set(computeChapterNumbers(tree.tree).keys())
  const files = new Map<ChapterId, string>()
  const usedNames = new Set<string>()
  for (const [chapterId, name] of Object.entries(rawFiles)) {
    if (!ids.has(chapterId)) return fail({ code: 'file-orphan', chapterId })
    if (typeof name !== 'string' || !isContentFileName(name)) {
      return fail({ code: 'file-name-invalid', chapterId })
    }
    if (usedNames.has(name)) return fail({ code: 'file-duplicate', chapterId })
    usedNames.add(name)
    files.set(chapterId, name)
  }
  for (const chapterId of ids) {
    if (!files.has(chapterId)) return fail({ code: 'file-missing', chapterId })
  }

  return { ok: true, manifest: { title: m.title, tree: tree.tree, files } }
}

function fail(issue: ManifestIssue): ParseManifestResult {
  return { ok: false, issue }
}
