import type {
  DocumentOutput,
  ExportFormat,
  ExportReport,
  OutputFailure,
  OutputResult,
  RenderRequest,
} from '../application/document_output.ts'
import type { PdfLayout } from '../domain/pdf_layout/pdf_layout.ts'

/** 内存版输出，用于测试与 Storybook：记录每次导出与样张请求，可注入导出失败。 */
export class MemoryDocumentOutput implements DocumentOutput {
  private failures: OutputFailure[] = []

  readonly exports: Array<{
    format: ExportFormat
    targetPath: string
    request: RenderRequest
    pdfLayout: PdfLayout
  }> = []
  /** 下一次导出报告中缺失的图片。 */
  missingImages: string[] = []

  async exportDocument(
    _projectPath: string,
    request: RenderRequest,
    format: ExportFormat,
    targetPath: string,
    pdfLayout: PdfLayout,
  ): Promise<OutputResult<ExportReport>> {
    this.exports.push({ format, targetPath, request, pdfLayout })
    const failure = this.failures.shift()
    if (failure) return { ok: false, error: failure }
    return { ok: true, value: { missingImages: this.missingImages } }
  }

  readonly previews: Array<{ request: RenderRequest; pdfLayout: PdfLayout }> = []

  async previewPdf(
    _projectPath: string,
    request: RenderRequest,
    pdfLayout: PdfLayout,
  ): Promise<OutputResult<readonly string[]>> {
    // 注入的失败只作用于导出。
    this.previews.push({ request, pdfLayout })
    return { ok: true, value: [`<svg data-paper="${pdfLayout.paper}"></svg>`] }
  }

  failNext(...failures: OutputFailure[]): void {
    this.failures.push(...failures)
  }
}
