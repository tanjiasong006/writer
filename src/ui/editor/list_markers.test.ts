import { afterEach, expect, test } from 'vitest'
import { EditorView } from 'prosemirror-view'
import { parseMarkdown } from './markdown.ts'
import { createEditorState } from './plugins.ts'
import { setListNumbering } from './commands.ts'
import { TextSelection } from 'prosemirror-state'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

function viewOf(markdown: string): EditorView {
  view = new EditorView(document.body.appendChild(document.createElement('div')), {
    state: createEditorState(parseMarkdown(markdown)),
  })
  return view
}

function markers(editor: EditorView): Array<string | null> {
  return [...editor.dom.querySelectorAll('li')].map((item) => item.getAttribute('data-marker'))
}

test('有编号样式的列表各项带编号文字（从起始编号算起），默认样式与任务项没有', () => {
  const editor = viewOf('<!-- writer:list 一、 -->\n9. 甲\n10. 乙\n    <!-- writer:list (1) -->\n    1. 子\n11. [x] 丙\n\n段落\n\n1. 默认\n')
  expect(editor.dom.querySelector('ol')!.getAttribute('data-numbering')).toBe('一、')
  expect(markers(editor)).toEqual(['九、', '十、', '(1)', null, null])
})

test('改变样式或增减项后编号随之更新', () => {
  const editor = viewOf('1. 甲\n2. 乙\n')
  editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)))
  setListNumbering('A.')(editor.state, editor.dispatch)
  expect(markers(editor)).toEqual(['A.', 'B.'])
  // 删除第一项：原来的第二项成为 A。
  const first = editor.state.doc.firstChild!.firstChild!
  editor.dispatch(editor.state.tr.delete(1, 1 + first.nodeSize))
  expect(markers(editor)).toEqual(['A.'])
})
