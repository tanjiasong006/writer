import type { Node } from 'prosemirror-model'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'

/** 把正文中的图片引用（如 ../assets/图.png）转换成可显示的地址；不能显示（项目外、远程地址等）返回 null。 */
export type ImageResolver = (reference: string) => string | null

/**
 * 编辑器中的图片：按项目资源显示；无法解析或加载失败时显示占位，引用本身不变。
 * 图片节点本身只保存正文中的引用，显示地址不进入文档。
 * 行内图片放在 span 中；独立成段的图（figure）放在块级的 div（.editor-figure）中。
 */
class ImageView implements NodeView {
  readonly dom: HTMLElement
  private node: Node
  private readonly resolve: ImageResolver

  constructor(node: Node, resolve: ImageResolver, block: boolean) {
    this.node = node
    this.resolve = resolve
    this.dom = document.createElement(block ? 'div' : 'span')
    this.dom.className = block ? 'editor-image editor-figure' : 'editor-image'
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
    this.dom.replaceChildren(image)
  }

  private showMissing(): void {
    const { src, alt } = this.node.attrs as { src: string; alt: string }
    const missing = document.createElement('span')
    missing.className = 'editor-image__missing'
    missing.textContent = `无法显示图片：${alt || src}`
    missing.title = src
    this.dom.replaceChildren(missing)
  }
}

export function imageNodeView(resolve: ImageResolver): NodeViewConstructor {
  return (node) => new ImageView(node, resolve, false)
}

export function figureNodeView(resolve: ImageResolver): NodeViewConstructor {
  return (node) => new ImageView(node, resolve, true)
}
