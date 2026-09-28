import { NodeSelection, Plugin } from 'prosemirror-state'
import { CellSelection } from 'prosemirror-tables'
import type { Node } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

/**
 * 自绘选区底色。
 *
 * WebKit 把段落第二行起每一行的选区底色向上延伸到上一行文字的底部，而第一行只有文字高度：
 * 从段落中间某一行开始选择时，第一行的底色比从段首开始选择时高出一截（与 caret.ts 中光标的问题同源）。
 * 因此原生选区底色设为透明（CSS 中的 ::selection），按行画出底色（与 CodeMirror 的做法相同）：
 * - 每一行的底色都是一整行的行高，以该行文字为中心；同一段中相邻的行首尾相接；
 * - 选区跨过行尾 / 行首时，底色延伸到文字块的右 / 左边缘；
 * - 选中的独立图片、分隔线等块按它们自己的外框画；
 * - 选中图片（有自己的外框）、选中表格单元格（有自己的底色）与空选区时不画；正文没有焦点时用浅灰色。
 * 底色元素放在编辑器 DOM 之外（挂载点中），不进入 ProseMirror 管理的内容。
 */
export function drawSelection(): Plugin {
  return new Plugin({ view: (view) => new SelectionView(view) })
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * 一个文字块中被选中部分的底色（每行一个）。
 * rects 是被选中文字的矩形（Range.getClientRects），lineHeight 是文字块的行高（NaN 表示 normal，不扩展），
 * content 是文字块内容区的左右边缘；extendStart / extendEnd 表示选区在这个文字块之前 / 之后还有内容。
 */
export function lineBoxes(
  rects: readonly Box[],
  lineHeight: number,
  content: { readonly left: number; readonly right: number },
  extendStart: boolean,
  extendEnd: boolean,
): Box[] {
  const lines: { left: number; top: number; right: number; bottom: number }[] = []
  const sorted = rects.filter((rect) => rect.right > rect.left).sort((a, b) => a.top - b.top)
  for (const rect of sorted) {
    const line = lines[lines.length - 1]
    if (line && rect.top < line.bottom && rect.bottom > line.top) {
      line.left = Math.min(line.left, rect.left)
      line.right = Math.max(line.right, rect.right)
      line.top = Math.min(line.top, rect.top)
      line.bottom = Math.max(line.bottom, rect.bottom)
    } else {
      // 不用展开运算：DOMRect 的字段是原型上的 getter。
      lines.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
    }
  }
  const last = lines.length - 1
  const boxes: Box[] = []
  lines.forEach((line, index) => {
    const height = Math.max(Number.isNaN(lineHeight) ? 0 : lineHeight, line.bottom - line.top)
    const center = (line.top + line.bottom) / 2
    boxes.push({
      left: index > 0 || extendStart ? content.left : Math.max(line.left, content.left),
      right: index < last || extendEnd ? content.right : Math.min(line.right, content.right),
      // 同一文字块中的行首尾相接：行中有图片等较高内容时也不重叠、不留缝。
      top: index > 0 ? boxes[index - 1].bottom : center - height / 2,
      bottom: center + height / 2,
    })
  })
  return boxes
}

class SelectionView {
  private readonly layer: HTMLElement
  private readonly observer: ResizeObserver | null

  constructor(private readonly view: EditorView) {
    this.layer = document.createElement('div')
    this.layer.className = 'editor-selection'
    view.dom.parentNode?.appendChild(this.layer)
    view.dom.addEventListener('focus', this.draw)
    view.dom.addEventListener('blur', this.draw)
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.draw)
    this.observer?.observe(view.dom)
    this.draw()
  }

  update(): void {
    this.draw()
  }

  destroy(): void {
    this.layer.remove()
    this.view.dom.removeEventListener('focus', this.draw)
    this.view.dom.removeEventListener('blur', this.draw)
    this.observer?.disconnect()
  }

  private readonly draw = (): void => {
    const { view, layer } = this
    const { selection, doc } = view.state
    const parent = layer.parentElement
    if (!parent || selection.empty || selection instanceof NodeSelection || selection instanceof CellSelection) {
      if (layer.firstChild) layer.replaceChildren()
      return
    }
    layer.classList.toggle('is-inactive', !view.hasFocus())
    const { from, to } = selection
    const boxes: Box[] = []
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) {
        boxes.push(...textblockBoxes(view, node, pos, from, to))
        return false
      }
      if (node.isAtom && node.isBlock) {
        const dom = view.nodeDOM(pos)
        if (dom instanceof HTMLElement) boxes.push((dom.querySelector('img') ?? dom).getBoundingClientRect())
        return false
      }
      return true
    })
    const origin = parent.getBoundingClientRect()
    layer.replaceChildren(
      ...boxes.map((box) => {
        const element = document.createElement('div')
        element.className = 'editor-selection__box'
        element.style.left = `${box.left - origin.left}px`
        element.style.top = `${box.top - origin.top}px`
        element.style.width = `${box.right - box.left}px`
        element.style.height = `${box.bottom - box.top}px`
        return element
      }),
    )
  }
}

/** 文字块 node（起点 pos）中被选区 [from, to] 选中的部分的底色。 */
function textblockBoxes(view: EditorView, node: Node, pos: number, from: number, to: number): Box[] {
  const element = view.nodeDOM(pos)
  if (!(element instanceof HTMLElement)) return []
  const start = Math.max(from, pos + 1)
  const end = Math.min(to, pos + 1 + node.content.size)
  const style = getComputedStyle(element)
  const outer = element.getBoundingClientRect()
  const content = {
    left: outer.left + parseFloat(style.borderLeftWidth || '0') + parseFloat(style.paddingLeft || '0'),
    right: outer.right - parseFloat(style.borderRightWidth || '0') - parseFloat(style.paddingRight || '0'),
  }
  const lineHeight = parseFloat(style.lineHeight)
  const extendStart = from < pos + 1
  const extendEnd = to > end
  let rects: Box[] = []
  if (start < end) {
    const range = document.createRange()
    const head = view.domAtPos(start)
    const tail = view.domAtPos(end)
    range.setStart(head.node, head.offset)
    range.setEnd(tail.node, tail.offset)
    rects = Array.from(range.getClientRects())
  }
  if (rects.length === 0) {
    // 没有选中文字，但选区跨过了文字块的结尾（空段落、从段尾开始选择）：像原生选区一样画一小块，表示换行也被选中。
    if (!extendEnd) return []
    const coords = view.coordsAtPos(start)
    const width = parseFloat(style.fontSize) / 2 || 4
    rects = [{ left: coords.left, right: coords.left + width, top: coords.top, bottom: coords.bottom }]
    return lineBoxes(rects, lineHeight, content, false, false)
  }
  return lineBoxes(rects, lineHeight, content, extendStart, extendEnd)
}
