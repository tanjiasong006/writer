import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { Node } from 'prosemirror-model'
import type { NodeView } from 'prosemirror-view'

/**
 * 公式的显示（docs/decisions.md 第 14 节）：用 KaTeX 渲染 LaTeX，只是显示，文档中保存的是原文。
 * KaTeX 不认识的写法以红色原文显示（与导出中排版失败时相同），悬停提示原因。
 * 编辑器与全文阅读共用。
 */

/** 把 tex 渲染进 dom；display 为 true 时是行间样式。 */
export function renderMath(dom: HTMLElement, tex: string, display: boolean): void {
  dom.title = ''
  dom.classList.remove('is-invalid')
  if (tex.trim() === '') {
    dom.textContent = '（空公式）'
    dom.classList.add('is-invalid')
    return
  }
  try {
    // renderToString 不检查文档模式（katex.render 在没有 doctype 的文档中拒绝渲染），结果相同。
    dom.innerHTML = katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'html' })
  } catch (error) {
    dom.textContent = tex
    dom.classList.add('is-invalid')
    dom.title = error instanceof Error ? error.message : String(error)
  }
}

/** 公式节点的 DOM：行内公式是 span，公式块是 div。 */
export function staticMathDOM(node: Node): HTMLElement {
  const block = node.type.name === 'math_block'
  const dom = document.createElement(block ? 'div' : 'span')
  dom.className = block ? 'math-block' : 'math-inline'
  dom.contentEditable = 'false'
  renderMath(dom, node.attrs.tex as string, block || (node.attrs.display as boolean))
  return dom
}

/** 编辑器中的节点视图：内容只随 tex 变化重新渲染；单击选中，双击等由编辑器处理。 */
export function mathNodeView(initial: Node): NodeView {
  let node = initial
  const dom = staticMathDOM(node)
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false
      if (next.attrs.tex !== node.attrs.tex || next.attrs.display !== node.attrs.display) {
        const block = next.type.name === 'math_block'
        renderMath(dom, next.attrs.tex as string, block || (next.attrs.display as boolean))
      }
      node = next
      return true
    },
    ignoreMutation: () => true,
  }
}
