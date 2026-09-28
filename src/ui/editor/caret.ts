import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

/**
 * 自绘文字光标。
 *
 * WebKit 在段落第二行起把原生光标向上延伸到上一行文字的底部：行距越大，第二行起的光标越高，与第一行不一致。
 * 因此原生光标设为透明（CSS 中的 caret-color），按光标位置的文字高度画一条竖线（与 CodeMirror 的做法相同）：
 * - 只在正文有焦点、选区是空的文字选区时显示；选中文字、选中图片、空隙光标（gapcursor 自己画）时不显示；
 * - 每次状态更新、获得 / 失去焦点、滚动与尺寸变化时重新定位，移动后重新开始闪烁；
 * - 输入法组字期间恢复原生光标（组字中的文字由输入法与浏览器管理），组字结束后再由这里画。
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
    const coords = view.coordsAtPos(selection.head)
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
