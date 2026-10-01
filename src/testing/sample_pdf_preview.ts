import type { OutputResult } from '../application/document_output.ts'
import { resolvePdfLayout, type PdfLayoutSettings } from '../domain/pdf_layout/pdf_layout.ts'

/**
 * Storybook 用的 PDF 样张：不经过 Rust 排版，按设置画出近似的页面（封面、目录、正文页），
 * 只用于查看样张区域的布局与状态，不代表真实排版结果。
 */
export function samplePdfPreview(delayMs = 200) {
  return (settings: PdfLayoutSettings): Promise<OutputResult<readonly string[]>> =>
    new Promise((resolve) => setTimeout(() => resolve({ ok: true, value: samplePages(settings) }), delayMs))
}

const PAPER_MM = { a4: [210, 297], b5: [176, 250], a5: [148, 210], letter: [215.9, 279.4] } as const
const MARGIN_MM = { narrow: 18, normal: 25, wide: 32 } as const
const LINE_HEIGHT = { compact: 1.5, normal: 1.75, loose: 2 } as const
const PT_PER_MM = 72 / 25.4

function samplePages(settings: PdfLayoutSettings): string[] {
  const layout = resolvePdfLayout(settings)
  const [w, h] = PAPER_MM[layout.paper].map((mm) => mm * PT_PER_MM)
  const margin = MARGIN_MM[layout.margin] * PT_PER_MM
  const size = Number(layout.bodySize)
  const pitch = size * LINE_HEIGHT[layout.lineHeight]
  const page = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}pt" height="${h}pt"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`
  const lines = (top: number, count: number) => {
    let out = ''
    for (let i = 0; i < count; i++) {
      const y = top + i * pitch
      if (y > h - margin - pitch) break
      const indent = layout.paragraph === 'indent' && i % 6 === 0 ? size * 2 : 0
      const width = i % 6 === 5 ? (w - 2 * margin) * 0.6 : w - 2 * margin - indent
      out += `<rect x="${margin + indent}" y="${y}" width="${width}" height="${size * 0.7}" fill="#c8c8c8"/>`
    }
    return out
  }
  const text = (x: number, y: number, s: number, content: string, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-size="${s}" text-anchor="${anchor}" font-family="sans-serif" fill="#222">${content}</text>`
  const footer = (n: string) => text(w / 2, h - margin / 2, 9, n, 'middle')
  const pages: string[] = []
  if (layout.cover) {
    pages.push(page(text(w / 2, h * 0.33, 26, '毕业论文', 'middle') + text(w / 2, h * 0.33 + 40, 16, '一项研究', 'middle')))
  }
  if (layout.toc) pages.push(page(text(margin, margin + 60, 18, '目录') + lines(margin + 90, 8) + footer('i')))
  const header =
    layout.header === 'none'
      ? ''
      : text(margin, margin - 12, 9, '毕业论文') + `<rect x="${margin}" y="${margin - 8}" width="${w - 2 * margin}" height="0.4" fill="#999"/>`
  pages.push(page(text(margin, margin + 54, 18, layout.chapterNumber === 'chapter' ? '第 1 章 绪论' : '1 绪论') + lines(margin + 90, 60) + footer('1')))
  pages.push(page(header + lines(margin + pitch, 60) + footer('2')))
  return pages
}
