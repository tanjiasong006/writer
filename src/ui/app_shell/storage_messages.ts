import type { IoKind, StorageFailure } from '../../application/project_storage.ts'

/**
 * 文件系统错误 → 说明原因与出路；只有无法分类时才附上操作系统的原始信息。
 * name 是出错的文件或文件夹名（不含完整路径，避免状态栏过长），可为空。
 */
export function messageForIo(kind: IoKind | undefined, name: string, osMessage: string): string {
  const target = name ? `「${name}」` : ''
  switch (kind) {
    case 'permission-denied':
      return `没有权限访问${target}。请检查文件夹权限，或把文档移到有写入权限的位置。`
    case 'read-only':
      return `${target || '文件'}所在的磁盘是只读的，无法写入。`
    case 'disk-full':
      return '磁盘空间不足，无法写入。请清理空间后重试。'
    case 'not-found':
      return `找不到${target || '文件或文件夹'}，它可能已被移动、重命名或删除。`
    case 'busy':
      return `${target || '文件'}正被其他程序占用。请关闭占用它的程序后重试。`
    default:
      return `文件读写失败${target ? `（${name}）` : ''}：${osMessage}`
  }
}

/**
 * 面向用户的文件名：路径的最后一段；位于项目内部目录 .writer/ 中时（用户从没见过这些文件），
 * 改用项目文件夹名。
 */
export function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const internal = parts.lastIndexOf('.writer')
  if (internal > 0) return parts[internal - 1]
  return parts.pop() ?? ''
}

/** 存储失败原因 → 面向用户的中文说明。 */
export function messageForStorageFailure(failure: StorageFailure): string {
  switch (failure.code) {
    case 'not-a-project':
      return '所选文件夹不是 Writer 文档。请选择文档所在的文件夹（其中有 writer.json 文件）。'
    case 'target-not-empty':
      return '目标位置已存在且不为空，请选择新的名称或空文件夹。'
    case 'manifest-invalid':
      return '文档结构文件 writer.json 已损坏或格式不正确，无法打开。'
    case 'version-unsupported':
      return '该文档由更新版本的 Writer 创建，请升级后再打开。'
    case 'journal-invalid':
      return '上次保存的恢复记录（.writer/journal.json）已损坏，为避免破坏数据已停止打开。正文仍在 content 文件夹中，请先备份整个文档文件夹。'
    case 'content-missing':
      return `章节正文文件 content/${failure.file} 不存在，为避免覆盖数据已停止打开。`
    case 'content-not-utf8':
      return `章节正文文件 content/${failure.file} 不是 UTF-8 文本，无法打开。`
    case 'content-required':
    case 'content-orphan':
      return '保存数据不完整，已停止保存以保护现有文件。'
    case 'project-locked':
      return '该文档已在另一个 Writer 窗口中打开。请先在那里关闭，避免两处编辑互相覆盖。'
    case 'asset-unsupported':
      return '暂不支持该图片格式，请使用 PNG、JPG 或 GIF。'
    case 'asset-too-large':
      return '图片超过 50 MB，无法插入。'
    case 'asset-not-found':
      return '找不到所选图片文件。'
    case 'io':
      return messageForIo(failure.kind, fileName(failure.path), failure.message)
    case 'unknown':
      return `发生未知错误：${failure.message}`
  }
}
