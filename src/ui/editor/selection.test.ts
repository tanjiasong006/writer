import { afterEach, expect, test } from 'vitest'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parseMarkdown } from './markdown.ts'
import { createEditorState } from './plugins.ts'
import { lineBoxes } from './selection.ts'

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

function layer(view: EditorView): HTMLElement {
  return view.dom.parentElement!.querySelector<HTMLElement>('.editor-selection')!
}

const content = { left: 0, right: 600 }
const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

test('每一行的底色都是一整行的行高，以文字为中心；从段落中间某一行开始选择时第一行不会更高', () => {
  // 行高 60、文字高 40：第 2、3 行的文字。
  const boxes = lineBoxes([rect(300, 70, 600, 110), rect(0, 130, 200, 170)], 60, content, false, false)
  expect(boxes).toEqual([rect(300, 60, 600, 120), rect(0, 120, 200, 180)])
  const fromFirstLine = lineBoxes([rect(300, 10, 600, 50), rect(0, 70, 200, 110)], 60, content, false, false)
  expect(fromFirstLine.map((box) => box.bottom - box.top)).toEqual([60, 60])
})

test('同一行的多个矩形（不同字体、行内格式）合成一行；中间的行铺满文字块宽度，行与行首尾相接', () => {
  const boxes = lineBoxes(
    [rect(100, 10, 300, 50), rect(300, 12, 600, 48), rect(0, 70, 580, 110), rect(0, 130, 50, 170)],
    60,
    content,
    false,
    false,
  )
  expect(boxes).toEqual([rect(100, 0, 600, 60), rect(0, 60, 600, 120), rect(0, 120, 50, 180)])
})

test('选区在文字块之前 / 之后还有内容时，首行延伸到左边缘、末行延伸到右边缘；空矩形被忽略', () => {
  const boxes = lineBoxes([rect(100, 10, 300, 50), rect(300, 10, 300, 50)], 60, content, true, true)
  expect(boxes).toEqual([rect(0, 0, 600, 60)])
})

test('行高为 normal（NaN）或行中有更高的内容时，使用内容本身的高度', () => {
  expect(lineBoxes([rect(0, 10, 100, 50)], Number.NaN, content, false, false)).toEqual([rect(0, 10, 100, 50)])
  expect(lineBoxes([rect(0, 0, 100, 200)], 60, content, false, false)).toEqual([rect(0, 0, 100, 200)])
})

test('底色层放在编辑器 DOM 之外；空选区与选中图片时没有底色，失去焦点时标记为非活动', () => {
  const view = viewOf('第一段\n\n![图](../assets/图.png)')
  expect(layer(view).parentElement).toBe(view.dom.parentElement)
  expect(view.dom.contains(layer(view))).toBe(false)

  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
  expect(layer(view).classList.contains('is-inactive')).toBe(false)

  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  expect(layer(view).childElementCount).toBe(0)

  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, view.state.doc.firstChild!.nodeSize)))
  expect(layer(view).childElementCount).toBe(0)

  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
  ;(view.dom as HTMLElement).blur()
  expect(layer(view).classList.contains('is-inactive')).toBe(true)
})

test('销毁编辑器时移除底色层', () => {
  const view = viewOf('正文')
  const mount = view.dom.parentElement!
  view.destroy()
  views.splice(views.indexOf(view), 1)
  expect(mount.querySelector('.editor-selection')).toBeNull()
  mount.remove()
})
