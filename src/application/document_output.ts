import type { ChapterId, ChapterTree } from '../domain/chapter_tree/chapter_tree.ts'
import {
  computeChapterNumbers,
  type ChapterNumber,
} from '../domain/chapter_numbering/chapter_numbering.ts'
import type { WriterDocument } from '../domain/document/document.ts'

/**
 * 全文输出（预览、导出）的端口与请求组装。渲染由 Rust `render` 模块完成，
 * 预览、Word、PDF 共用同一份请求与同一个 Markdown 解析器（docs/decisions.md 第 5 节）。
 */

/** 按章节树先序展开的全文：章节标题与编号来自结构，正文不含它们。 */
export interface RenderRequest {
  readonly title: string
  readonly chapters: readonly RenderChapter[]
}

export interface RenderChapter {
  readonly id: ChapterId
  readonly number: ChapterNumber
  readonly title: string
  readonly markdown: string
}

export type OutputFailure =
  | { readonly code: 'no-cjk-font' }
  | { readonly code: 'io'; readonly message: string }
  | { readonly code: 'render-failed'; readonly message: string }
  | { readonly code: 'unknown'; readonly message: string }

export type OutputResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: OutputFailure }

export interface DocumentOutput {
  /** 全文预览 HTML（已转义）；图片以 data-writer-src 给出本地路径。 */
  renderPreview(projectPath: string, request: RenderRequest): Promise<OutputResult<string>>
}

/** 渲染当前会话文档的全文预览。 */
export function previewDocument(
  output: DocumentOutput,
  projectPath: string,
  document: WriterDocument,
): Promise<OutputResult<string>> {
  return output.renderPreview(projectPath, buildRenderRequest(document))
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
  return { title: document.title, chapters }
}
