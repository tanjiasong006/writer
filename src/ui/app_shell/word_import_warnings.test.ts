import { expect, test } from 'vitest'
import { describeImportWarning } from './word_import_warnings'

test('表格警告准确说明降级结果', () => {
  expect(describeImportWarning('table_unsupported')).toContain('普通段落导入')
  expect(describeImportWarning('table_header_assumed')).toContain('第一行作为表头')
  expect(describeImportWarning('table_header_rows_degraded')).toContain('其余表头行已作为正文')
  expect(describeImportWarning('table_cell_structure_degraded')).toContain('转换为空格')
})

test('未知警告保留原始代码，内置属性名也不例外', () => {
  expect(describeImportWarning('future_warning: detail')).toBe('未识别的导入警告：future_warning: detail')
  expect(describeImportWarning('toString')).toBe('未识别的导入警告：toString')
})

test('域警告说明缓存结果和功能降级', () => {
  expect(describeImportWarning('field_unsupported')).toContain('结果已作为普通内容导入')
  expect(describeImportWarning('field_unsupported')).toContain('域功能未保留')
})
