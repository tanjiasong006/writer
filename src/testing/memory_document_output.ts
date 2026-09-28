import type {
  DocumentOutput,
  OutputFailure,
  OutputResult,
  RenderRequest,
} from '../application/document_output.ts'

/**
 * 内存版输出，用于测试与 Storybook：预览生成简化的 HTML（与 Rust 渲染结构相同的外层标记），
 * 记录每次请求，可注入失败。
 */
export class MemoryDocumentOutput implements DocumentOutput {
  readonly previews: RenderRequest[] = []
  private failures: OutputFailure[] = []

  failNext(...failures: OutputFailure[]): void {
    this.failures.push(...failures)
  }

  async renderPreview(_projectPath: string, request: RenderRequest): Promise<OutputResult<string>> {
    this.previews.push(request)
    const failure = this.failures.shift()
    if (failure) return { ok: false, error: failure }
    const sections = request.chapters
      .map(
        (chapter) =>
          `<section class="chapter" data-chapter-id="${escape(chapter.id)}">` +
          `<h${Math.min(chapter.number.length, 5) + 1} class="chapter-heading">` +
          `<span class="chapter-number">${chapter.number.join('.')}</span>${escape(chapter.title)}` +
          `</h${Math.min(chapter.number.length, 5) + 1}>` +
          chapter.markdown
            .split(/\n{2,}/)
            .filter((paragraph) => paragraph.trim().length > 0)
            .map((paragraph) => `<p>${escape(paragraph)}</p>`)
            .join('') +
          `</section>`,
      )
      .join('')
    return { ok: true, value: `<h1 class="doc-title">${escape(request.title)}</h1>${sections}` }
  }
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
