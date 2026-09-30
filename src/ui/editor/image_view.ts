import type { Node } from 'prosemirror-model'
import { NodeSelection } from 'prosemirror-state'
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view'
import { nodes } from './schema.ts'

/** 把正文中的图片引用（如 ../assets/图.png）转换成可显示的地址；不能显示（项目外、远程地址等）返回 null。 */
export type ImageResolver = (reference: string) => string | null

/**
 * 编辑器中的图片：按项目资源显示；无法解析或加载失败时显示占位，引用本身不变。
 * 图片节点本身只保存正文中的引用，显示地址不进入文档。
 * 行内图片放在 span 中；独立成段的图（figure）放在块级的 div（.editor-figure）中，下方是图注。
 */
class ImageView implements NodeView {
  readonly dom: HTMLElement
  /** 放图片或占位的元素：行内图片是 dom 本身，figure 是 dom 中图注之前的部分。 */
  private readonly picture: HTMLElement
  protected node: Node
  private readonly resolve: ImageResolver

  constructor(node: Node, resolve: ImageResolver, block: boolean) {
    this.node = node
    this.resolve = resolve
    this.dom = document.createElement(block ? 'div' : 'span')
    this.dom.className = block ? 'editor-image editor-figure' : 'editor-image'
    if (block) {
      this.picture = document.createElement('div')
      this.picture.className = 'editor-figure__picture'
      this.dom.append(this.picture)
    } else {
      this.picture = this.dom
    }
    this.render()
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false
    const changed = node.attrs.src !== this.node.attrs.src || node.attrs.alt !== this.node.attrs.alt
    this.node = node
    if (changed) this.render()
    return true
  }

  ignoreMutation(): boolean {
    return true
  }

  private render(): void {
    const { src, alt } = this.node.attrs as { src: string; alt: string }
    const url = this.resolve(src)
    if (url === null) {
      this.showMissing()
      return
    }
    const image = document.createElement('img')
    image.src = url
    image.alt = alt
    image.title = src
    image.draggable = false
    image.addEventListener('error', () => this.showMissing(), { once: true })
    this.picture.replaceChildren(image)
  }

  private showMissing(): void {
    const { src, alt } = this.node.attrs as { src: string; alt: string }
    const missing = document.createElement('span')
    missing.className = 'editor-image__missing'
    missing.textContent = `无法显示图片：${alt || src}`
    missing.title = src
    this.picture.replaceChildren(missing)
  }
}

/**
 * 独立成段的图片与它的图注（替代文字，导出为 PDF / Word 的图注）。
 *
 * figure 仍是原子节点：图注用节点内的原生文本框编辑，ProseMirror 不处理文本框中的事件（stopEvent），
 * 文字输入、输入法与编辑中的撤销都由文本框自己完成；结束编辑时图注有变化才写回节点（一个事务，可撤销）。
 * 没有图注时文本框只在选中图片或正在编辑时显示（“添加图注”），见 ChapterEditor.vue 的样式。
 */
class FigureView extends ImageView {
  private readonly caption: HTMLTextAreaElement
  /** 文本框的自动高度：隐藏的同内容元素撑开外层网格，文本框铺满同一格。 */
  private readonly sizer: HTMLElement
  private readonly view: EditorView
  private readonly getPos: () => number | undefined
  /** 结束编辑时返回正文（Enter / Tab / Esc）；焦点被点击等方式带走时为 false。 */
  private returning = false

  constructor(node: Node, view: EditorView, getPos: () => number | undefined, resolve: ImageResolver) {
    super(node, resolve, true)
    this.view = view
    this.getPos = getPos
    this.sizer = document.createElement('div')
    this.sizer.className = 'editor-figure__caption'
    this.caption = document.createElement('textarea')
    this.caption.className = 'editor-figure__caption-input'
    this.caption.rows = 1
    this.caption.placeholder = '添加图注'
    this.caption.setAttribute('aria-label', '图注')
    this.caption.spellcheck = false
    this.sizer.append(this.caption)
    this.dom.append(this.sizer)
    this.showCaption(node.attrs.alt as string)

    this.caption.addEventListener('input', () => {
      // 图注只有一行：粘贴进来的换行替换为空格。
      const { value, selectionStart } = this.caption
      const single = value.replace(/\r\n|\r|\n/g, ' ')
      if (single !== value) {
        this.caption.value = single
        this.caption.setSelectionRange(selectionStart, selectionStart)
      }
      this.sizer.dataset.value = single
    })
    this.caption.addEventListener('keydown', (event) => this.onKeydown(event))
    // 可拖动的外层会把文本框里的拖选变成拖动图片：编辑期间不可拖动。
    this.caption.addEventListener('pointerdown', () => (this.dom.draggable = false))
    this.caption.addEventListener('focus', () => {
      this.dom.draggable = false
      this.dom.classList.add('is-editing')
    })
    this.caption.addEventListener('blur', () => this.finish())
  }

  override update(node: Node): boolean {
    if (!super.update(node)) return false
    // 编辑中不覆盖文本框（撤销等外部变化在编辑结束后才可能发生）。
    if (document.activeElement !== this.caption) this.showCaption(node.attrs.alt as string)
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target === this.caption
  }

  private showCaption(alt: string): void {
    this.caption.value = alt
    this.sizer.dataset.value = alt
    this.dom.classList.toggle('has-caption', alt !== '')
  }

  private onKeydown(event: KeyboardEvent): void {
    // 输入法组字中的 Enter / Esc 属于输入法。
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.showCaption(this.node.attrs.alt as string)
      this.returnToText()
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      this.returnToText()
    }
  }

  /** 结束编辑并回到正文，选中这张图片。 */
  private returnToText(): void {
    this.returning = true
    this.view.focus()
    this.returning = false
  }

  private finish(): void {
    this.dom.classList.remove('is-editing')
    this.dom.draggable = true
    const pos = this.getPos()
    if (pos === undefined) return
    const alt = this.caption.value.trim()
    this.showCaption(alt)
    const { state } = this.view
    const tr = state.tr
    if (alt !== this.node.attrs.alt) tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, alt })
    if (this.returning) tr.setSelection(NodeSelection.create(tr.doc, pos))
    if (tr.docChanged || this.returning) this.view.dispatch(tr)
  }
}

export function imageNodeView(resolve: ImageResolver): NodeViewConstructor {
  return (node) => new ImageView(node, resolve, false)
}

export function figureNodeView(resolve: ImageResolver): NodeViewConstructor {
  return (node, view, getPos) => new FigureView(node, view, getPos, resolve)
}

/** 编辑选中图片的图注，光标放在末尾；没有选中独立成段的图片时返回 false。 */
export function editSelectedCaption(view: EditorView): boolean {
  const { selection } = view.state
  if (!(selection instanceof NodeSelection) || selection.node.type !== nodes.figure) return false
  const caption = (view.nodeDOM(selection.from) as HTMLElement | null)?.querySelector('textarea')
  if (!caption) return false
  caption.focus()
  caption.setSelectionRange(caption.value.length, caption.value.length)
  return true
}
