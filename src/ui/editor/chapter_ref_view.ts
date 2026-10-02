import type { Node } from 'prosemirror-model'
import { NodeSelection, Plugin } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import type { ChapterId, ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { chapterRefText, parseChapterRefAddress } from '../../domain/chapter_reference/chapter_reference.ts'
import { nodes } from './schema.ts'
import { IS_MAC } from '../common/shortcuts.ts'

/**
 * 章节引用的显示（docs/decisions.md 第 9 节）：文字按当前章节树生成，不存进文档。
 * 章节改名、移动后只更新显示，不改变正文、不产生 change、不进入撤销历史。
 */

/** 引用的目标：显示的文字（按引用的显示格式）、目标章节与它的完整名称（编号 + 标题，用于提示与“前往”）。 */
export interface ChapterRefResolved {
  readonly text: string
  readonly id: ChapterId
  readonly name: string
}

/** 引用地址 → 目标；目标不存在或地址格式错误（失效引用）时为 null。 */
export type ChapterRefLabel = (href: string) => ChapterRefResolved | null

/** 编辑展示中的引用文字：编号写成 "2.1"。 */
export function chapterRefLabels(tree: ChapterTree): ChapterRefLabel {
  const targets = new Map<string, { readonly number: string; readonly title: string }>()
  const numbers = computeChapterNumbers(tree)
  const visit = (nodes: ChapterTree): void => {
    for (const node of nodes) {
      targets.set(node.id, { number: (numbers.get(node.id) ?? []).join('.'), title: node.title })
      visit(node.children)
    }
  }
  visit(tree)
  return (href) => {
    const address = parseChapterRefAddress(href)
    const target = address.kind === 'ref' ? targets.get(address.id) : undefined
    if (address.kind !== 'ref' || !target) return null
    return {
      text: chapterRefText(target.number, target.title, address.show),
      id: address.id,
      name: chapterRefText(target.number, target.title, 'number-title'),
    }
  }
}

/** 没有章节树时（如单独使用编辑器）：所有引用都无法解析，显示为失效。 */
export const NO_CHAPTER_REFS: ChapterRefLabel = () => null

/** 填写引用元素：生成的文字，失效时显示链接文字（提示原来的目标）并标记。悬停提示目标与前往方式。 */
function fill(dom: HTMLElement, node: Node, label: ChapterRefLabel, hint: boolean): void {
  const resolved = label(node.attrs.href as string)
  dom.textContent = resolved?.text ?? (node.attrs.cached as string)
  dom.classList.toggle('is-broken', resolved === null)
  if (resolved === null) dom.title = '引用的章节不存在'
  else dom.title = hint ? `${resolved.name}（${IS_MAC ? '⌘' : 'Ctrl'} + 单击前往）` : resolved.name
}

function element(node: Node, label: ChapterRefLabel, hint: boolean): HTMLElement {
  const dom = document.createElement('span')
  dom.className = 'chapter-ref'
  dom.dataset.chapterRef = node.attrs.href as string
  fill(dom, node, label, hint)
  return dom
}

/** 只读展示（全文阅读）中的引用：单击即前往，提示中只有目标。 */
export function staticChapterRefDOM(node: Node, label: ChapterRefLabel): HTMLElement {
  return element(node, label, false)
}

/**
 * 编辑器中引用的节点视图。setLabel 在章节树变化时更新所有引用的文字，不经过事务。
 */
export function chapterRefNodeViews(initial: ChapterRefLabel) {
  let label = initial
  const views = new Set<{ refresh(): void }>()

  const nodeView = (initialNode: Node): NodeView => {
    let node = initialNode
    const dom = element(node, label, true)
    const view = { refresh: () => fill(dom, node, label, true) }
    views.add(view)
    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        dom.dataset.chapterRef = node.attrs.href as string
        view.refresh()
        return true
      },
      ignoreMutation: () => true,
      destroy: () => views.delete(view),
    }
  }

  return {
    nodeView,
    setLabel(next: ChapterRefLabel): void {
      if (next === label) return
      label = next
      for (const view of views) view.refresh()
    },
  }
}

/** 编辑器中引用元素（或其中的元素）对应的引用位置；不是引用时为 null。 */
export function chapterRefPos(view: EditorView, target: EventTarget | null): number | null {
  const dom = target instanceof Element ? target.closest('.chapter-ref') : null
  if (!dom || !view.dom.contains(dom)) return null
  const at = view.posAtDOM(dom, 0)
  const pos = [at, at - 1].find((p) => p >= 0 && view.nodeDOM(p) === dom)
  return pos !== undefined && view.state.doc.nodeAt(pos)?.type === nodes.chapter_ref ? pos : null
}

/**
 * 单击引用时整体选中它（浏览器在不可编辑的行内元素上按下鼠标时会放置光标或开始文字选择，
 * ProseMirror 不一定选中节点）。按住 Shift 时按默认方式扩展选区。
 */
export function chapterRefSelection(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (event.button !== 0 || event.shiftKey) return false
          const pos = chapterRefPos(view, event.target)
          if (pos === null) return false
          event.preventDefault()
          view.focus()
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
          return true
        },
      },
    },
  })
}
