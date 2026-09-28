import { afterEach, expect, test } from 'vitest'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parseMarkdown } from './markdown.ts'
import { createEditorState } from './plugins.ts'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove()
    view.destroy()
  }
})

function viewOf(markdown: string): EditorView {
  const mount = document.body.appendChild(document.createElement('div'))
  const view = new EditorView(mount, { state: createEditorState(parseMarkdown(markdown)) })
  views.push(view)
  return view
}

function caret(view: EditorView): HTMLElement {
  return view.dom.parentElement!.querySelector<HTMLElement>('.editor-caret')!
}

test('自绘光标放在编辑器 DOM 之外，只在有焦点且选区为空的文字选区时显示', () => {
  const view = viewOf('第一段\n\n![图](../assets/图.png)')
  expect(caret(view).parentElement).toBe(view.dom.parentElement)
  expect(view.dom.contains(caret(view))).toBe(false)
  expect(caret(view).hidden).toBe(true)

  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  expect(caret(view).hidden).toBe(false)

  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
  expect(caret(view).hidden).toBe(true)

  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, view.state.doc.firstChild!.nodeSize)))
  expect(caret(view).hidden).toBe(true)

  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  ;(view.dom as HTMLElement).blur()
  expect(caret(view).hidden).toBe(true)
})

test('输入法组字期间隐藏自绘光标并恢复原生光标，组字结束后再显示', () => {
  const view = viewOf('正文')
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
  expect(caret(view).hidden).toBe(true)
  expect(view.dom.classList.contains('is-composing')).toBe(true)
  view.dom.dispatchEvent(new CompositionEvent('compositionend'))
  expect(caret(view).hidden).toBe(false)
  expect(view.dom.classList.contains('is-composing')).toBe(false)
})

test('销毁编辑器时移除光标元素', () => {
  const view = viewOf('正文')
  const mount = view.dom.parentElement!
  view.destroy()
  views.splice(views.indexOf(view), 1)
  expect(mount.querySelector('.editor-caret')).toBeNull()
  mount.remove()
})
