import type { ChapterId, ChapterTree } from '../domain/chapter_tree/chapter_tree.ts'
import {
  computeChapterNumbers,
  type ChapterNumber,
} from '../domain/chapter_numbering/chapter_numbering.ts'
import type { WriterDocument } from '../domain/document/document.ts'
import {
  resolveTheme,
  type DocumentTheme,
  type ImageOverride,
} from '../domain/document_style/document_style.ts'
import type { IoKind } from './project_storage.ts'

/**
 * 全文输出（Word / PDF 导出）的端口与请求组装。渲染由 Rust `render` 模块完成，
 * Word、PDF 共用同一份请求与同一个 Markdown 解析器（docs/decisions.md 第 5 节）。
 */

/**
 * 按章节树先序展开的全文：章节标题与编号来自结构，正文不含它们。
 * 排版来自 theme（已按主题与用户调整解析好的语义样式）与 images（图片文件键 → 布局），
 * Word、PDF 各自把它们翻译成自己的样式。
 */
export interface RenderRequest {
  readonly title: string
  readonly chapters: readonly RenderChapter[]
  readonly theme: DocumentTheme
  readonly images: Readonly<Record<string, ImageOverride>>
}

export interface RenderChapter {
  readonly id: ChapterId
  readonly number: ChapterNumber
  readonly title: string
  readonly markdown: string
}

export type OutputFailure =
  | { readonly code: 'no-cjk-font' }
  | { readonly code: 'io'; readonly kind?: IoKind; readonly message: string }
  | { readonly code: 'render-failed'; readonly message: string }
  | { readonly code: 'unknown'; readonly message: string }

export type OutputResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: OutputFailure }

export type ExportFormat = 'docx' | 'pdf'

/** 导出完成后的报告：可恢复的问题，需要告知用户。 */
export interface ExportReport {
  /** 无法嵌入的图片引用（缺失、越出项目、格式损坏）。 */
  readonly missingImages: readonly string[]
}

export interface DocumentOutput {
  /**
   * 导出到 targetPath。导出内容是内存中的当前文档（包含尚未保存的修改）。
   * 目标文件原子写入：失败时不会留下半个文件，也不破坏同名旧文件。
   */
  exportDocument(
    projectPath: string,
    request: RenderRequest,
    format: ExportFormat,
    targetPath: string,
  ): Promise<OutputResult<ExportReport>>
}

/** 导出当前文档。 */
export function exportDocument(
  output: DocumentOutput,
  projectPath: string,
  document: WriterDocument,
  format: ExportFormat,
  targetPath: string,
): Promise<OutputResult<ExportReport>> {
  return output.exportDocument(projectPath, buildRenderRequest(document), format, targetPath)
}

/** 按章节树先序（即阅读顺序）展开文档。 */
export function buildRenderRequest(document: WriterDocument): RenderRequest {
  const numbers = computeChapterNumbers(document.tree)
  const chapters: RenderChapter[] = []
  const visit = (nodes: ChapterTree): void => {
    for (const node of nodes) {
      chapters.push({
        id: node.id,
        number: numbers.get(node.id) ?? [],
        title: node.title,
        markdown: document.contents.get(node.id) ?? '',
      })
      visit(node.children)
    }
  }
  visit(document.tree)
  return {
    title: document.title,
    chapters,
    theme: resolveTheme(document.style),
    images: Object.fromEntries(document.style.images),
  }
}
