import type { Mark, MarkType, Node } from 'prosemirror-model'
import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { marks } from './schema.ts'

/**
 * 自绘文字光标。
 *
 * WebKit 在段落第二行起把原生光标向上延伸到上一行文字的底部：行距越大，第二行起的光标越高，与第一行不一致。
 * 因此原生光标设为透明（CSS 中的 caret-color），按光标位置的文字高度画一条竖线（与 CodeMirror 的做法相同）：
 * - 只在正文有焦点、选区是空的文字选区时显示；选中文字、选中图片、空隙光标（gapcursor 自己画）时不显示；
 * - 每次状态更新、获得 / 失去焦点、滚动与尺寸变化时重新定位，移动后重新开始闪烁；
 * - 输入法组字期间恢复原生光标（组字中的文字由输入法与浏览器管理），组字结束后再由这里画。
 * - 高度随之后输入的文字：在上下标与正文的交界处，光标与之后输入的文字一样大（见 caretCoords），
 *   因此在上标末尾按 → 离开上标后，光标恢复正文的大小。
 * 光标元素放在编辑器 DOM 之外（挂载点中），不进入 ProseMirror 管理的内容。
 */
export function drawCaret(): Plugin {
  return new Plugin({ view: (view) => new CaretView(view) })
}

class CaretView {
  private readonly caret: HTMLElement
  private readonly observer: ResizeObserver | null
  private composing = false

  constructor(private readonly view: EditorView) {
    this.caret = document.createElement('div')
    this.caret.className = 'editor-caret'
    this.caret.hidden = true
    view.dom.parentNode?.appendChild(this.caret)
    view.dom.addEventListener('focus', this.draw)
    view.dom.addEventListener('blur', this.draw)
    view.dom.addEventListener('scroll', this.draw, true)
    view.dom.addEventListener('compositionstart', this.startComposition)
    view.dom.addEventListener('compositionend', this.endComposition)
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.draw)
    this.observer?.observe(view.dom)
    this.draw()
  }

  update(): void {
    this.draw()
  }

  destroy(): void {
    this.caret.remove()
    this.view.dom.removeEventListener('focus', this.draw)
    this.view.dom.removeEventListener('blur', this.draw)
    this.view.dom.removeEventListener('scroll', this.draw, true)
    this.view.dom.removeEventListener('compositionstart', this.startComposition)
    this.view.dom.removeEventListener('compositionend', this.endComposition)
    this.observer?.disconnect()
  }

  private readonly startComposition = (): void => {
    this.composing = true
    this.view.dom.classList.add('is-composing')
    this.draw()
  }

  private readonly endComposition = (): void => {
    this.composing = false
    this.view.dom.classList.remove('is-composing')
    this.draw()
  }

  private readonly draw = (): void => {
    const { view, caret } = this
    const { selection } = view.state
    const parent = caret.parentElement
    const visible =
      parent !== null && !this.composing && view.hasFocus() && selection instanceof TextSelection && selection.empty
    if (!visible) {
      caret.hidden = true
      return
    }
    const coords = caretCoords(view)
    const origin = parent.getBoundingClientRect()
    caret.hidden = false
    caret.style.left = `${coords.left - origin.left}px`
    caret.style.top = `${coords.top - origin.top}px`
    caret.style.height = `${coords.bottom - coords.top}px`
    // 移动后重新开始闪烁：输入与移动光标时光标保持可见。
    caret.style.animation = 'none'
    void caret.offsetWidth
    caret.style.animation = ''
  }
}

const SCRIPT_MARKS: readonly MarkType[] = [marks.sup, marks.sub]

function scriptOf(markSet: readonly Mark[]): MarkType | null {
  return markSet.find((mark) => SCRIPT_MARKS.includes(mark.type))?.type ?? null
}

/** 向前查找同一行中格式相同的文字时最多看的字符数。 */
const LOOK_BACK = 200

/**
 * 光标的位置与高度，按之后输入的文字是否为上下标（storedMarks 或光标处的格式）决定：
 * - 默认取后面的文字（折行处光标在下一行开头）；之后输入的与前面的文字相同、与后面的不同时取前面的；
 * - 两侧都不同（如段尾离开上标、对空光标设置上标）时，高度取同一行中前面最近的、格式相同的文字，没有时按原位置。
 */
export function caretCoords(view: EditorView): { left: number; top: number; bottom: number } {
  const { state } = view
  const $head = state.selection.$head
  const typing = scriptOf(state.storedMarks ?? $head.marks())
  const matches = (node: Node | null) => node !== null && scriptOf(node.marks) === typing
  const before = $head.nodeBefore
  const after = $head.nodeAfter
  const side = !matches(after) && matches(before) ? -1 : 1
  const coords = view.coordsAtPos($head.pos, side)
  if (matches(side < 0 ? before : after) || (before === null && after === null)) return coords
  const start = $head.start()
  for (let pos = $head.pos - 1; pos >= start && $head.pos - pos <= LOOK_BACK; pos--) {
    const node = state.doc.resolve(pos).nodeAfter
    if (!node?.isText || scriptOf(node.marks) !== typing) continue
    const rect = view.coordsAtPos(pos, 1)
    // 已经是上一行的文字。
    if (rect.bottom <= coords.top || rect.top >= coords.bottom) break
    return { left: coords.left, top: rect.top, bottom: rect.bottom }
  }
  return coords
}
