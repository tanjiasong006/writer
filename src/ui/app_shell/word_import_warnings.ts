import type { ImportWarningDetail } from '../../application/document_import.ts'

export function describeImportWarnings(warnings: readonly string[], details: readonly ImportWarningDetail[]): string[] {
  const detailedCodes = new Set(details.map(detail => detail.code))
  return [
    ...details.map(({ code, location, contentType, nearbyText }) => {
      const position = [`第 ${location.block} 个正文块`, location.tableIndex === undefined ? '' : `第 ${location.tableIndex} 个表格`, location.row === undefined ? '' : `第 ${location.row} 行`, location.cell === undefined ? '' : `第 ${location.cell} 个单元格`].filter(Boolean).join('，')
      return `${position}（${contentType}）：${describeImportWarning(code)}${nearbyText ? ` 附近文字：${nearbyText}` : ''}`
    }),
    ...warnings.filter(code => !detailedCodes.has(code)).map(describeImportWarning),
  ]
}

/** 将后端稳定警告码转换为用户可读的导入说明。 */
export function describeImportWarning(code: string): string {
  const messages: Record<string, string> = {
    table_unsupported: '部分表格结构不受支持，已将单元格内容作为普通段落导入。',
    table_header_assumed: '部分表格没有明确的 Word 表头，已将第一行作为表头。',
    table_header_rows_degraded: '部分表格的多行 Word 表头仅保留第一行为表头，其余表头行已作为正文。',
    table_cell_structure_degraded: '部分表格单元格中的段落或换行已转换为空格。',
    image_external_or_missing: '部分图片为外部图片或缺失，未导入。',
    image_path_unsupported: '部分图片路径不受支持，未导入。',
    image_unreadable: '部分图片无法读取，未导入。',
    image_format_unsupported: '部分图片格式不受支持，未导入。',
    heading_image_unsupported: '标题中的图片未导入。',
    body_content_unsupported: '文档中的部分内容不受支持，未导入。',
    list_numbering_unsupported: '部分列表编号未能保留，包括标题自动编号或通过段落样式继承的列表编号。',
    hyperlink_target_unsupported: '部分超链接目标未能保留。',
    drawing_unsupported: '文档中的部分绘图未导入。',
    note_unsupported: '文档中的脚注或尾注未导入。',
    field_unsupported: '部分域不受支持或不完整；可读取的结果已作为普通内容导入，域功能未保留。',
    math_unsupported: '文档中的公式未导入。',
  }
  return Object.hasOwn(messages, code) ? messages[code]! : `未识别的导入警告：${code}`
}
