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
import {
  DEFAULT_THEME_ID,
  defaultDocumentStyle,
  imageKey,
  isDefaultStyle,
  isThemeId,
  overrideStyle,
  setImageLayout,
  type DocumentStyle,
  type ImageOverride,
  type StyleOverrides,
  type ThemeId,
} from '../../domain/document_style/document_style.ts'

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
  /** 文档样式；使用默认样式时省略（没有设置过样式的项目，writer.json 与引入样式之前完全相同）。 */
  readonly style?: ManifestStyle
}

/** writer.json 中的 style：主题、主题之上的调整、图片布局（图片文件键 → 布局）。空的部分省略。 */
export interface ManifestStyle {
  readonly theme: ThemeId
  readonly overrides?: StyleOverrides
  readonly images?: Readonly<Record<string, ImageOverride>>
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
 * 远程地址、绝对路径、非法编码、以及跳出项目目录的引用返回 null。
 * 与 Rust `render::resolve_image` 规则一致（Rust 另外比较规范化路径以防符号链接逃逸）。
 */
export function resolveAssetReference(projectPath: string, reference: string): string | null {
  // 图片文件键就是它在项目中指向的文件（相对项目根目录）：显示的文件与布局所属的图片永远一致。
  const key = imageKey(reference)
  if (key === null) return null
  const separator = projectPath.includes('\\') && !projectPath.includes('/') ? '\\' : '/'
  return [projectPath.replace(/[\\/]+$/, ''), ...key.split('/')].join(separator)
}

/** 由文档生成 manifest；文件名总是按当前编号重新推导。 */
export function buildManifest(document: WriterDocument): Manifest {
  const manifest: Manifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    title: document.title,
    chapters: document.tree,
    files: Object.fromEntries(contentFiles(document.tree)),
  }
  return isDefaultStyle(document.style) ? manifest : { ...manifest, style: buildStyle(document.style) }
}

function buildStyle(style: DocumentStyle): ManifestStyle {
  return {
    theme: style.theme,
    ...(Object.keys(style.overrides).length > 0 ? { overrides: style.overrides } : {}),
    ...(style.images.size > 0 ? { images: Object.fromEntries(style.images) } : {}),
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
  readonly style: DocumentStyle
}

export type ParseManifestResult =
  | { readonly ok: true; readonly manifest: ParsedManifest }
  | { readonly ok: false; readonly issue: ManifestIssue }

/**
 * 在信任边界上校验 manifest。输入是 JSON.parse 的结果（unknown）。
 * 通过后返回可信的章节树与文件对应关系；文件名不要求等于按编号推导的名字，
 * 下一次保存会把它们整理成规范名字。
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

  return { ok: true, manifest: { title: m.title, tree: tree.tree, files, style: parseStyle(m.style) } }
}

/**
 * 解析 style。样式不影响文档内容，因此从宽处理：缺失（旧项目）使用默认样式；
 * 无法识别的主题、非法的调整值与图片布局逐项忽略（跟随主题），不拒绝打开项目。
 */
export function parseStyle(raw: unknown): DocumentStyle {
  const style = defaultDocumentStyle()
  if (!isRecord(raw)) return style
  let result: DocumentStyle = { ...style, theme: isThemeId(raw.theme) ? raw.theme : DEFAULT_THEME_ID }
  if (isRecord(raw.overrides)) result = overrideStyle(result, pickOverrides(raw.overrides))
  if (isRecord(raw.images)) {
    for (const [key, layout] of Object.entries(raw.images)) {
      // 只接受规范形式的身份（如 assets/图.png），与 imageKey 生成的一致。
      if (!isRecord(layout) || imageKey(`../${key}`) !== key) continue
      result = setImageLayout(result, key, layout as ImageOverride)
    }
  }
  return result
}

const OVERRIDE_FIELDS: ReadonlyArray<keyof StyleOverrides> = [
  'bodyFont',
  'bodySize',
  'lineHeight',
  'headingFont',
  'heading1Size',
  'heading2Size',
  'heading3Size',
]

function pickOverrides(raw: Record<string, unknown>): StyleOverrides {
  const picked: Record<string, unknown> = {}
  for (const field of OVERRIDE_FIELDS) if (field in raw) picked[field] = raw[field]
  return picked as StyleOverrides
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(issue: ManifestIssue): ParseManifestResult {
  return { ok: false, issue }
}
