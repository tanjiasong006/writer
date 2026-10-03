import { onBeforeUnmount, ref, type Ref } from 'vue'
import type { ExportFormat, ExportReport, OutputResult } from '../../application/document_output.ts'
import type { DesktopShell } from '../../application/desktop_shell.ts'
import { messageForOutputFailure } from './output_messages.ts'

/** 导出成功的提示在一段时间后自动消失；错误一直显示到用户关闭。 */
const NOTICE_DURATION_MS = 8000

export interface ExportNotice {
  readonly message: string
  /** 导出的文件：提示中的"在访达中显示"。 */
  readonly path: string
}

export interface DocumentExport {
  /** 正在导出的格式；导出期间禁用导出，避免重复写同一文件。 */
  readonly exporting: Readonly<Ref<ExportFormat | null>>
  readonly notice: Ref<ExportNotice | null>
  exportAs(format: ExportFormat): Promise<void>
}

/** 文件名中不允许的字符替换为 -，空标题使用默认名。 */
function exportBaseName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
  return name.length > 0 ? name : '未命名文档'
}

/** 导出：选择保存位置 → 导出 → 成功提示（含无法嵌入的图片数）；失败说明交给 onError。 */
export function useExport(options: {
  readonly shell: Pick<DesktopShell, 'pickExportPath'>
  readonly title: () => string
  readonly run: (format: ExportFormat, target: string) => Promise<OutputResult<ExportReport>>
  /** 开始新的导出时以 null 清除上一次的错误。 */
  readonly onError: (message: string | null) => void
}): DocumentExport {
  const exporting = ref<ExportFormat | null>(null)
  const notice = ref<ExportNotice | null>(null)
  let noticeTimer: ReturnType<typeof setTimeout> | null = null

  function showNotice(next: ExportNotice): void {
    notice.value = next
    if (noticeTimer !== null) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => {
      noticeTimer = null
      notice.value = null
    }, NOTICE_DURATION_MS)
  }

  onBeforeUnmount(() => {
    if (noticeTimer !== null) clearTimeout(noticeTimer)
  })

  async function exportAs(format: ExportFormat): Promise<void> {
    if (exporting.value !== null) return
    options.onError(null)
    notice.value = null
    const target = await options.shell.pickExportPath(format, exportBaseName(options.title()))
    if (target === null) return
    exporting.value = format
    try {
      const result = await options.run(format, target)
      if (!result.ok) {
        options.onError(messageForOutputFailure(result.error))
        return
      }
      const fileName = target.split(/[\\/]/).pop() ?? target
      const missing = result.value.missingImages.length
      const broken = result.value.brokenReferences.length
      const formulas = result.value.invalidFormulas?.length ?? 0
      const problems = [
        missing > 0 ? `${missing} 张图片无法嵌入，已用文字占位` : null,
        broken > 0 ? `${broken} 处章节引用已失效，已按原来的文字输出` : null,
        formulas > 0 ? `${formulas} 个公式无法排版，已按原文输出` : null,
      ].filter((problem) => problem !== null)
      showNotice({
        message: problems.length > 0 ? `已导出 ${fileName}，其中 ${problems.join('；')}。` : `已导出 ${fileName}`,
        path: target,
      })
    } finally {
      exporting.value = null
    }
  }

  return { exporting, notice, exportAs }
}
