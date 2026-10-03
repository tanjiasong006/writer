/** Word 与 PDF 都能直接嵌入的图片格式（与项目资源导入的规则相同，docs/project-format.md 第 4 节）。 */
const EMBEDDABLE = new Set(['image/png', 'image/jpeg', 'image/gif'])

/**
 * 粘贴或拖入的图片 → 可以导入项目的数据。PNG / JPEG / GIF 原样使用；其他格式（如 WebP、TIFF、HEIC）
 * 由 WebView 解码后转为 PNG（文件名的扩展名随之改为 .png）。WebView 不能解码时为 null。
 */
export async function embeddableImage(file: File): Promise<{ readonly name: string; readonly bytes: Uint8Array } | null> {
  if (EMBEDDABLE.has(file.type)) return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return null
    const stem = file.name.replace(/\.[^.]*$/, '')
    return { name: `${stem || 'image'}.png`, bytes: new Uint8Array(await blob.arrayBuffer()) }
  } catch {
    return null
  }
}
