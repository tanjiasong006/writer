import type {
  DocumentOutput,
  ExportFormat,
  ExportReport,
  OutputFailure,
  OutputResult,
  RenderRequest,
} from '../application/document_output.ts'

/** 内存版输出，用于测试与 Storybook：记录每次导出请求，可注入失败。 */
export class MemoryDocumentOutput implements DocumentOutput {
  private failures: OutputFailure[] = []

  readonly exports: Array<{ format: ExportFormat; targetPath: string; request: RenderRequest }> = []
  /** 下一次导出报告中缺失的图片。 */
  missingImages: string[] = []

  async exportDocument(
    _projectPath: string,
    request: RenderRequest,
    format: ExportFormat,
    targetPath: string,
  ): Promise<OutputResult<ExportReport>> {
    this.exports.push({ format, targetPath, request })
    const failure = this.failures.shift()
    if (failure) return { ok: false, error: failure }
    return { ok: true, value: { missingImages: this.missingImages } }
  }

  failNext(...failures: OutputFailure[]): void {
    this.failures.push(...failures)
  }
}
