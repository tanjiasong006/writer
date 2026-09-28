import { expect, test } from 'vitest'
import type { IoKind, StorageFailure } from '../../application/project_storage.ts'
import { messageForStorageFailure } from './storage_messages.ts'
import { messageForOutputFailure } from './output_messages.ts'

/** kind 可能是本版本不认识的值（来自更新的后端），用字符串构造。 */
const io = (kind: string | undefined, path = '/文稿/论文/.writer/staging'): StorageFailure => ({
  code: 'io',
  operation: 'create-dir',
  path,
  kind: kind as IoKind | undefined,
  message: 'Permission denied (os error 13)',
})

test('常见文件错误给出原因与出路，不显示操作系统英文原文', () => {
  const cases: Array<[string, string]> = [
    // 出错的是项目内部目录时，说明中用项目文件夹名。
    ['permission-denied', '没有权限访问「论文」'],
    ['read-only', '只读'],
    ['disk-full', '磁盘空间不足'],
    ['not-found', '找不到「论文」'],
    ['busy', '正被其他程序占用'],
  ]
  for (const [kind, expected] of cases) {
    const message = messageForStorageFailure(io(kind))
    expect(message).toContain(expected)
    expect(message).not.toContain('os error')
  }
})

test('无法分类的错误保留原始信息，便于排查', () => {
  expect(messageForStorageFailure(io(undefined, '/文稿/论文/content/ch_1.md'))).toBe(
    '文件读写失败（ch_1.md）：Permission denied (os error 13)',
  )
  expect(messageForStorageFailure(io('something-new'))).toContain('os error 13')
})

test('导出失败使用同样的说明', () => {
  const message = messageForOutputFailure({ code: 'io', kind: 'disk-full', message: 'No space left on device' })
  expect(message).toBe('导出失败：磁盘空间不足，无法写入。请清理空间后重试。')
})
