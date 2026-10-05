import { afterEach, describe, expect, test } from 'vitest'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parseMarkdown } from './markdown.ts'
import { createEditorState } from './plugins.ts'
import { caretCoords } from './caret.ts'
import { exitMarksForward } from './commands.ts'

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

describe('光标的高度随之后输入的文字', () => {
  /** 测试环境没有排版：正文文字高 10–30，上标文字高 5–15；记下每次取位置时的参数。 */
  function measured(markdown: string, head: number) {
    const view = viewOf(markdown)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, head)))
    const calls: Array<[number, number]> = []
    view.coordsAtPos = (pos: number, side = 1) => {
      calls.push([pos, side])
      const $pos = view.state.doc.resolve(pos)
      const node = side < 0 ? $pos.nodeBefore : ($pos.nodeAfter ?? $pos.nodeBefore)
      const sup = node?.marks.some((mark) => mark.type.name === 'sup')
      return sup ? { left: pos, right: pos, top: 5, bottom: 15 } : { left: pos, right: pos, top: 10, bottom: 30 }
    }
    return { view, calls }
  }

  test('上下标与正文的交界处：取之后输入的格式所在的一侧（默认取后面）', () => {
    // m³|/d：之后输入的是上标（前面的格式延续），光标与上标一样大。
    const { view, calls } = measured('m<sup>3</sup>/d', 3)
    expect(caretCoords(view)).toMatchObject({ top: 5, bottom: 15 })
    expect(calls).toEqual([[3, -1]])
    // 按 → 离开上标后，光标与后面的正文一样大。
    view.dispatch(view.state.tr.setStoredMarks([]))
    expect(caretCoords(view)).toMatchObject({ top: 10, bottom: 30 })
    // 两侧格式相同时取后面（折行处光标在下一行开头）。
    const plain = measured('正文', 2)
    caretCoords(plain.view)
    expect(plain.calls).toEqual([[2, 1]])
  })

  test('段尾离开上标：高度取同一行中前面最近的正文文字', () => {
    const { view } = measured('m<sup>3</sup>', 3)
    expect(caretCoords(view)).toMatchObject({ top: 5, bottom: 15 })
    exitMarksForward(view.state, view.dispatch)
    expect(caretCoords(view)).toEqual({ left: 3, top: 10, bottom: 30 })
  })
})
