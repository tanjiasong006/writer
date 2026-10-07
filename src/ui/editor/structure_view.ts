import SmilesDrawer from 'smiles-drawer'
import type { Node } from 'prosemirror-model'
import type { NodeView } from 'prosemirror-view'
import { NO_CONDITIONS, normalizeArrow, structureSources, type StructureConditions, type StructureSource } from './markdown.ts'
import { moleculeBySmiles } from './structure_library.ts'

/**
 * 化学结构式的显示（docs/decisions.md 第 22 节）：用 smiles-drawer 把 SMILES 画成骨架式，文档中保存的是 SMILES 原文。
 * 反应式（`反应物>试剂>产物`）中每个分子分别画出，以“＋”相连，中间是箭头（→ ⇌ ＝），试剂与条件写在箭头上下。
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

type Theme = keyof typeof THEMES

const FONT_FAMILY = 'Arial, Helvetica, sans-serif'

const OPTIONS = {
  // 大于 0 时 viewBox 紧贴内容（为 0 时补成正方形）；尺寸另行设置。
  scale: 1,
  // 不把末端基团缩写成文字（如乙酸会画成“COOHCH₃”）。
  compactDrawing: false,
  bondThickness: 1.2,
  fontSizeLarge: 13,
  fontSizeSmall: 7,
  padding: 4,
  fontFamily: FONT_FAMILY,
  themes: THEMES,
}

const SVG_NS = 'http://www.w3.org/2000/svg'

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

/** 反应式的三部分；不是反应式（没有 >）时为 null，写法不对时是错误说明。 */
function reactionParts(smiles: string): { readonly reactants: string[]; readonly reagents: string[]; readonly products: string[] } | { readonly error: string } | null {
  if (!smiles.includes('>')) return null
  const parts = smiles.split('>')
  if (parts.length !== 3) return { error: '反应式的写法是“反应物>试剂>产物”（没有试剂时写作“反应物>>产物”）' }
  const molecules = (part: string) => part.split('.').map((molecule) => molecule.trim()).filter((molecule) => molecule !== '')
  const [reactants, reagents, products] = parts.map(molecules)
  if (reactants.length === 0 || products.length === 0) return { error: '反应式需要反应物与产物' }
  return { reactants, reagents, products }
}

/** SMILES（分子或反应式）能否画出。 */
export function isValidSmiles(smiles: string): boolean {
  const text = smiles.trim()
  if (text === '') return false
  const reaction = reactionParts(text)
  if (reaction === null) return 'tree' in parse(text)
  if ('error' in reaction) return false
  return [...reaction.reactants, ...reaction.reagents, ...reaction.products].every((molecule) => 'tree' in parse(molecule))
}

/** 画好的结构式：SVG 元素与其尺寸（SVG 单位）。 */
export interface StructureDrawing {
  readonly svg: SVGSVGElement
  readonly width: number
  readonly height: number
}

type Drawn = StructureDrawing | { readonly error: string }

/** 化学式文字（数字为下标）。 */
function subscriptDigits(text: string): string {
  return text.replace(/\d/g, (digit) => String.fromCharCode(0x2080 + Number(digit)))
}

/** 画出一个分子（可以是 . 隔开的几个片段）；库中的无机小分子写成化学式。 */
function drawMolecule(smiles: string, theme: Theme): Drawn {
  const formula = moleculeBySmiles(smiles)?.formula
  if (formula) return drawFormula(subscriptDigits(formula), theme)
  const parsed = parse(smiles)
  if ('error' in parsed) return parsed
  try {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('xmlns', SVG_NS)
    new SmilesDrawer.SvgDrawer(OPTIONS).draw(parsed.tree, svg, theme)
    const [, , width, height] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number)
    if (!(width > 0 && height > 0)) return { error: 'empty' }
    svg.removeAttribute('style')
    return { svg, width, height }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** 画出 SMILES（分子或反应式）；无法解析或画出时返回错误说明。 */
export function drawStructure(smiles: string, theme: Theme = 'text', conditions: StructureConditions = NO_CONDITIONS): Drawn {
  const text = smiles.trim()
  const reaction = reactionParts(text)
  if (reaction === null) return drawMolecule(text, theme)
  if ('error' in reaction) return reaction
  return drawReaction(reaction, conditions, theme)
}

// 反应式的版式（SVG 单位，键长 30）。
const TEXT_SIZE = 12
const PLUS_SIZE = 16
const GAP = 8
const ARROW_MIN = 44
const ARROW_PADDING = 8
const HEAD = 7
const PADDING = 4

/** 文字宽度的估计（不依赖排版）：中文等全角字符 1em，其余 0.6em。 */
function textWidth(text: string, size: number): number {
  return [...text].reduce((width, char) => width + (char.charCodeAt(0) > 0x2e7f ? size : size * 0.6), 0)
}

/** 试剂写在箭头上方：库中有的写名称，其他写分子式（数字为下标）。 */
function reagentLabel(smiles: string): string {
  const molecule = moleculeBySmiles(smiles)
  if (molecule) return molecule.names[0]
  const parsed = parse(smiles)
  if ('error' in parsed) return smiles
  return subscriptDigits(new SmilesDrawer.SvgDrawer(OPTIONS).preprocessor.getMolecularFormula(parsed.tree) as string)
}

/** 写成文字的化学式，与原子符号同样大小（smiles-drawer 的字号以 pt 为单位）。 */
function drawFormula(text: string, theme: Theme): StructureDrawing {
  const size = (OPTIONS.fontSizeLarge * 4) / 3
  const width = textWidth(text, size) + 2 * PADDING
  const height = size * 1.4 + 2 * PADDING
  const svg = element('svg', { xmlns: SVG_NS, viewBox: `0 0 ${width} ${height}` }) as SVGSVGElement
  svg.append(textElement(text, width / 2, height / 2 + size * 0.35, size, theme === 'text' ? 'currentColor' : '#000000'))
  return { svg, width, height }
}

function element(name: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
  return node
}

function textElement(text: string, x: number, y: number, size: number, color: string): SVGElement {
  const node = element('text', { x, y, fill: color, 'font-size': size, 'font-family': FONT_FAMILY, 'text-anchor': 'middle' })
  node.textContent = text
  return node
}

/** 箭头：→、⇌（上下两条半箭头）、＝（两条平行线），中心在 y。 */
function arrowElements(arrow: string, x0: number, x1: number, y: number, color: string): SVGElement[] {
  const stroke = { stroke: color, 'stroke-width': 1.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' }
  const line = (y: number) => element('line', { x1: x0, y1: y, x2: x1, y2: y, ...stroke })
  const path = (d: string) => element('path', { d, ...stroke })
  if (arrow === '=') return [line(y - 2), line(y + 2)]
  if (arrow === '<=>') {
    return [
      line(y - 2.5),
      path(`M ${x1 - HEAD} ${y - 2.5 - HEAD / 2} L ${x1} ${y - 2.5}`),
      line(y + 2.5),
      path(`M ${x0 + HEAD} ${y + 2.5 + HEAD / 2} L ${x0} ${y + 2.5}`),
    ]
  }
  return [line(y), path(`M ${x1 - HEAD} ${y - HEAD / 2} L ${x1} ${y} L ${x1 - HEAD} ${y + HEAD / 2}`)]
}

function drawReaction(
  reaction: { readonly reactants: string[]; readonly reagents: string[]; readonly products: string[] },
  conditions: StructureConditions,
  theme: Theme,
): Drawn {
  const color = theme === 'text' ? 'currentColor' : '#000000'
  const side = (molecules: readonly string[]) => molecules.map((molecule) => drawMolecule(molecule, theme))
  const reactants = side(reaction.reactants)
  const products = side(reaction.products)
  const failed = [...reactants, ...products].find((drawn) => 'error' in drawn)
  if (failed) return failed
  const drawn = (list: Drawn[]) => list as StructureDrawing[]

  const above = [...reaction.reagents.map(reagentLabel), conditions.above.trim()].filter((text) => text !== '').join('，')
  const below = conditions.below.trim()
  const arrowLength = Math.max(ARROW_MIN, textWidth(above, TEXT_SIZE), textWidth(below, TEXT_SIZE)) + 2 * ARROW_PADDING
  const arrowBlock = 2 * (TEXT_SIZE + 6) + 6
  const height = Math.max(arrowBlock, ...drawn([...reactants, ...products]).map((molecule) => molecule.height)) + 2 * PADDING
  const middle = height / 2

  const svg = element('svg', { xmlns: SVG_NS }) as SVGSVGElement
  let x = PADDING
  const place = (molecules: StructureDrawing[]) => {
    molecules.forEach((molecule, index) => {
      if (index > 0) {
        const plus = textElement('+', x + GAP + PLUS_SIZE * 0.3, middle + PLUS_SIZE * 0.35, PLUS_SIZE, color)
        svg.append(plus)
        x += 2 * GAP + PLUS_SIZE * 0.6
      }
      molecule.svg.setAttribute('x', String(x))
      molecule.svg.setAttribute('y', String(middle - molecule.height / 2))
      molecule.svg.setAttribute('width', String(molecule.width))
      molecule.svg.setAttribute('height', String(molecule.height))
      svg.append(molecule.svg)
      x += molecule.width
    })
  }
  place(drawn(reactants))
  x += GAP
  const x0 = x
  const x1 = x + arrowLength
  svg.append(...arrowElements(normalizeArrow(conditions.arrow), x0, x1, middle, color))
  if (above !== '') svg.append(textElement(above, (x0 + x1) / 2, middle - 7, TEXT_SIZE, color))
  if (below !== '') svg.append(textElement(below, (x0 + x1) / 2, middle + 7 + TEXT_SIZE * 0.8, TEXT_SIZE, color))
  x = x1 + GAP
  place(drawn(products))
  const width = x + PADDING
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  return { svg, width, height }
}

/** 把结构式画进 dom（编辑器与全文阅读）。 */
export function renderStructure(dom: HTMLElement, smiles: string, conditions: StructureConditions = NO_CONDITIONS): void {
  dom.title = ''
  dom.classList.remove('is-invalid')
  dom.replaceChildren()
  if (smiles.trim() === '') {
    dom.textContent = '（空结构式）'
    dom.classList.add('is-invalid')
    return
  }
  const drawing = drawStructure(smiles, 'text', conditions)
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

/** 节点中的条件。 */
function nodeConditions(node: Node): StructureConditions {
  return { arrow: node.attrs.arrow as string, above: node.attrs.above as string, below: node.attrs.below as string }
}

/** 结构式节点的 DOM。 */
export function staticStructureDOM(node: Node): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'structure-block'
  dom.contentEditable = 'false'
  renderStructure(dom, node.attrs.smiles as string, nodeConditions(node))
  return dom
}

/** 编辑器中的节点视图：只随 SMILES 与条件变化重新绘制。 */
export function structureNodeView(initial: Node): NodeView {
  let node = initial
  const dom = staticStructureDOM(node)
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false
      const changed = ['smiles', 'arrow', 'above', 'below'].some((key) => next.attrs[key] !== node.attrs[key])
      if (changed) renderStructure(dom, next.attrs.smiles as string, nodeConditions(next))
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

/** 导出用的结构式图片：黑色、白底的 PNG（base64）与显示尺寸（磅），以及它对应的 SMILES 与条件。 */
export interface StructureImage extends StructureSource {
  readonly png: string
  readonly width: number
  readonly height: number
}

/**
 * 把结构式画成导出用的 PNG（docs/decisions.md 第 22 节：输出中是前端画好的图片）。
 * 在浏览器中把 SVG 栅格化：smiles-drawer 的 SVG 用 CSS 定位文字，导出端的 SVG 渲染不能正确显示。无法画出时为 null。
 */
export async function structureImage(source: StructureSource): Promise<StructureImage | null> {
  const drawing = drawStructure(source.smiles, 'print', source)
  if ('error' in drawing) return null
  const pixelWidth = Math.ceil(drawing.width * EXPORT_PIXELS_PER_UNIT)
  const pixelHeight = Math.ceil(drawing.height * EXPORT_PIXELS_PER_UNIT)
  drawing.svg.setAttribute('width', String(pixelWidth))
  drawing.svg.setAttribute('height', String(pixelHeight))
  // data: URL 而不是 blob:：应用的 CSP（tauri.conf.json）的 img-src 不允许 blob:，图片会加载失败。
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing.svg.outerHTML)}`
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
    const { smiles, arrow, above, below } = source
    return { smiles, arrow, above, below, png, width: drawing.width * EXPORT_PT_PER_UNIT, height: drawing.height * EXPORT_PT_PER_UNIT }
  } catch {
    return null
  }
}

/** 画出各章节正文中全部结构式的导出图片（导出与 PDF 样张使用）；画不出的不在结果中，由导出按原文输出。 */
export async function documentStructureImages(markdowns: readonly string[]): Promise<StructureImage[]> {
  const sources = new Map<string, StructureSource>()
  for (const source of markdowns.flatMap((markdown) => structureSources(markdown))) {
    sources.set(JSON.stringify([source.smiles, source.arrow, source.above, source.below]), source)
  }
  const images = await Promise.all([...sources.values()].map((source) => structureImage(source)))
  return images.filter((image): image is StructureImage => image !== null)
}
