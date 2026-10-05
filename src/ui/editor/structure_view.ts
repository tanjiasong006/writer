import SmilesDrawer from 'smiles-drawer'
import type { Node } from 'prosemirror-model'
import type { NodeView } from 'prosemirror-view'
import { structureSources } from './markdown.ts'

/**
 * 化学结构式的显示（docs/decisions.md 第 22 节）：用 smiles-drawer 把 SMILES 画成骨架式，文档中保存的是 SMILES 原文。
 * 无法解析的 SMILES 以红色原文显示（与公式相同），悬停提示原因。编辑器、全文阅读与导出的图片共用同一套画法。
 */

/** 显示尺寸：SVG 的一个单位对应的 CSS 像素（键长 30 个单位）。 */
export const STRUCTURE_SCALE = 0.9

const MONO = (color: string) =>
  Object.fromEntries(['FOREGROUND', 'C', 'O', 'N', 'F', 'CL', 'BR', 'I', 'P', 'S', 'B', 'SI', 'H'].map((key) => [key, color]))

/** 单色：编辑器中随文字颜色（深色外观中是浅色），导出的图片是黑色。 */
const THEMES = {
  text: { ...MONO('currentColor'), BACKGROUND: 'transparent' },
  print: { ...MONO('#000000'), BACKGROUND: '#ffffff' },
}

const OPTIONS = {
  // 大于 0 时 viewBox 紧贴内容（为 0 时补成正方形）；尺寸另行设置。
  scale: 1,
  // 不把末端基团缩写成文字（如乙酸会画成“COOHCH₃”）。
  compactDrawing: false,
  bondThickness: 1.2,
  fontSizeLarge: 13,
  fontSizeSmall: 7,
  padding: 4,
  themes: THEMES,
}

/** 解析 SMILES；无法解析时返回错误说明。 */
function parse(smiles: string): { readonly tree: unknown } | { readonly error: string } {
  let result: { tree: unknown } | { error: string } = { error: '' }
  SmilesDrawer.parse(
    smiles,
    (tree) => (result = { tree }),
    (error) => (result = { error: error instanceof Error ? error.message : String(error) }),
  )
  return result
}

/** SMILES 能否画出。 */
export function isValidSmiles(smiles: string): boolean {
  return smiles.trim() !== '' && 'tree' in parse(smiles.trim())
}

/** 画好的结构式：SVG 元素与其尺寸（SVG 单位）。 */
export interface StructureDrawing {
  readonly svg: SVGSVGElement
  readonly width: number
  readonly height: number
}

/** 画出 SMILES；无法解析或画出时返回错误说明。 */
export function drawStructure(smiles: string, theme: keyof typeof THEMES = 'text'): StructureDrawing | { readonly error: string } {
  const parsed = parse(smiles.trim())
  if ('error' in parsed) return parsed
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    new SmilesDrawer.SvgDrawer(OPTIONS).draw(parsed.tree, svg, theme)
    const [, , width, height] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number)
    if (!(width > 0 && height > 0)) return { error: 'empty' }
    svg.removeAttribute('style')
    return { svg, width, height }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** 把 smiles 画进 dom（编辑器与全文阅读）。 */
export function renderStructure(dom: HTMLElement, smiles: string): void {
  dom.title = ''
  dom.classList.remove('is-invalid')
  dom.replaceChildren()
  if (smiles.trim() === '') {
    dom.textContent = '（空结构式）'
    dom.classList.add('is-invalid')
    return
  }
  const drawing = drawStructure(smiles)
  if ('error' in drawing) {
    dom.textContent = smiles
    dom.classList.add('is-invalid')
    dom.title = drawing.error
    return
  }
  drawing.svg.setAttribute('width', String(drawing.width * STRUCTURE_SCALE))
  drawing.svg.setAttribute('height', String(drawing.height * STRUCTURE_SCALE))
  drawing.svg.setAttribute('role', 'img')
  drawing.svg.setAttribute('aria-label', smiles)
  dom.append(drawing.svg)
}

/** 结构式节点的 DOM。 */
export function staticStructureDOM(node: Node): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'structure-block'
  dom.contentEditable = 'false'
  renderStructure(dom, node.attrs.smiles as string)
  return dom
}

/** 编辑器中的节点视图：只随 SMILES 变化重新绘制。 */
export function structureNodeView(initial: Node): NodeView {
  let node = initial
  const dom = staticStructureDOM(node)
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false
      if (next.attrs.smiles !== node.attrs.smiles) renderStructure(dom, next.attrs.smiles as string)
      node = next
      return true
    },
    ignoreMutation: () => true,
  }
}

/** 导出中结构式图片的分辨率：每个 SVG 单位的像素数。 */
const EXPORT_PIXELS_PER_UNIT = 4
/** 导出中一个 SVG 单位的磅数（与编辑器中 STRUCTURE_SCALE 个 CSS 像素相同大小）。 */
const EXPORT_PT_PER_UNIT = STRUCTURE_SCALE * 0.75

/** 导出用的结构式图片：黑色、白底的 PNG（base64）与显示尺寸（磅）。 */
export interface StructureImage {
  readonly smiles: string
  readonly png: string
  readonly width: number
  readonly height: number
}

/**
 * 把 SMILES 画成导出用的 PNG（docs/decisions.md 第 22 节：输出中是前端画好的图片）。
 * 在浏览器中把 SVG 栅格化：smiles-drawer 的 SVG 用 CSS 定位文字，导出端的 SVG 渲染不能正确显示。无法画出时为 null。
 */
export async function structureImage(smiles: string): Promise<StructureImage | null> {
  const drawing = drawStructure(smiles, 'print')
  if ('error' in drawing) return null
  const pixelWidth = Math.ceil(drawing.width * EXPORT_PIXELS_PER_UNIT)
  const pixelHeight = Math.ceil(drawing.height * EXPORT_PIXELS_PER_UNIT)
  drawing.svg.setAttribute('width', String(pixelWidth))
  drawing.svg.setAttribute('height', String(pixelHeight))
  const url = URL.createObjectURL(new Blob([drawing.svg.outerHTML], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, pixelWidth, pixelHeight)
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
    const png = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
    return { smiles, png, width: drawing.width * EXPORT_PT_PER_UNIT, height: drawing.height * EXPORT_PT_PER_UNIT }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 画出各章节正文中全部结构式的导出图片（导出与 PDF 样张使用）；画不出的不在结果中，由导出按原文输出。 */
export async function documentStructureImages(markdowns: readonly string[]): Promise<StructureImage[]> {
  const sources = new Set(markdowns.flatMap((markdown) => structureSources(markdown)))
  const images = await Promise.all([...sources].map((smiles) => structureImage(smiles)))
  return images.filter((image): image is StructureImage => image !== null)
}
