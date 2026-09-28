import type { StorageFailure } from '../../application/project_storage.ts'

/** 存储失败原因 → 面向用户的中文说明。 */
export function messageForStorageFailure(failure: StorageFailure): string {
  switch (failure.code) {
    case 'not-a-project':
      return '所选目录不是 Writer 文档（缺少 writer.json）。'
    case 'target-not-empty':
      return '目标位置已存在且不为空，请选择新的名称或空文件夹。'
    case 'manifest-invalid':
      return '文档结构文件 writer.json 已损坏或格式不正确，无法打开。'
    case 'version-unsupported':
      return '该文档由更新版本的 Writer 创建，请升级后再打开。'
    case 'journal-invalid':
      return '上次保存的恢复记录已损坏，为避免破坏数据已停止打开。请备份该文件夹后联系支持。'
    case 'content-missing':
      return `章节正文文件 content/${failure.file} 不存在，为避免覆盖数据已停止打开。`
    case 'content-not-utf8':
      return `章节正文文件 content/${failure.file} 不是 UTF-8 文本，无法打开。`
    case 'content-required':
    case 'content-orphan':
      return '保存数据不完整，已停止保存以保护现有文件。'
    case 'asset-unsupported':
      return '暂不支持该图片格式，请使用 PNG、JPG 或 GIF。'
    case 'asset-too-large':
      return '图片超过 50 MB，无法插入。'
    case 'asset-not-found':
      return '找不到所选图片文件。'
    case 'io':
      return `文件读写失败：${failure.message}`
    case 'unknown':
      return `发生未知错误：${failure.message}`
  }
}
