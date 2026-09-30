import type { OutputFailure } from '../../application/document_output.ts'
import { messageForIo } from './storage_messages.ts'

/** 导出失败原因 → 面向用户的中文说明。 */
export function messageForOutputFailure(failure: OutputFailure): string {
  switch (failure.code) {
    case 'no-cjk-font':
      return '找不到可显示中文的字体，导出已停止。请安装中文字体（如思源宋体 / Noto Serif CJK）后重试。'
    case 'io':
      return `导出失败：${messageForIo(failure.kind, '', failure.message)}`
    case 'render-failed':
      return `排版失败：${failure.message}`
    case 'unknown':
      return `发生未知错误：${failure.message}`
  }
}
