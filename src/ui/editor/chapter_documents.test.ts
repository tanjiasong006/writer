import { expect, test } from 'vitest'
import { Selection, TextSelection, type EditorState } from 'prosemirror-state'
import { undo } from 'prosemirror-history'
import { ChapterDocuments } from './chapter_documents.ts'

function typeAtEnd(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.insertText(text, Selection.atEnd(state.doc).from))
}

function undone(state: EditorState): EditorState {
  let next = state
  undo(state, (tr) => (next = state.apply(tr)))
  return next
}

test('打开章节：同一正文复用缓存状态，正文变化（外部修改）时重新创建', () => {
  const documents = new ChapterDocuments()
  const first = documents.stateFor('a', 'A')
  expect(documents.stateFor('a', 'A')).toBe(first)
  expect(documents.isCurrent('a', 'A')).toBe(true)
  const changed = documents.stateFor('a', '外部修改')
  expect(changed).not.toBe(first)
  expect(changed.doc.textContent).toBe('外部修改')
})

test('只有文档改变才产生新正文；选区变化返回 null 但记录状态', () => {
  const documents = new ChapterDocuments()
  const state = documents.stateFor('a', '引言')
  const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 2)))
  expect(documents.update('a', selected)).toBeNull()
  expect(documents.stateFor('a', '引言')).toBe(selected)

  const typed = typeAtEnd(selected, '！')
  expect(documents.update('a', typed)).toBe('引言！')
  expect(documents.isCurrent('a', '引言！')).toBe(true)
})

test('编辑后撤销回载入时的文档：给出载入时的原文，不做规范化', () => {
  const documents = new ChapterDocuments()
  const original = '* 星号\n*  强调*\n'
  const state = documents.stateFor('a', original)
  const typed = typeAtEnd(state, '1')
  expect(documents.update('a', typed)).not.toBe(original)
  expect(documents.update('a', undone(typed))).toBe(original)
})

test('各章节独立：一个章节的编辑不影响另一个章节的缓存', () => {
  const documents = new ChapterDocuments()
  const a = documents.stateFor('a', 'A')
  const b = documents.stateFor('b', 'B')
  expect(documents.update('a', typeAtEnd(a, '1'))).toBe('A1')
  expect(documents.stateFor('b', 'B')).toBe(b)
  expect(documents.update('b', typeAtEnd(b, '2'))).toBe('B2')
})

test('外部修改当前章节：以新正文为基准，替换文档的事务不产生新正文', () => {
  const documents = new ChapterDocuments()
  const state = documents.stateFor('a', 'A')
  const doc = documents.rebase('a', '新内容\n')
  const replaced = state.apply(state.tr.replaceWith(0, state.doc.content.size, doc.content))
  expect(documents.update('a', replaced)).toBeNull()
  expect(documents.update('a', typeAtEnd(replaced, '！'))).toBe('新内容！\n')
})

test('没有打开的章节不能记录状态', () => {
  const documents = new ChapterDocuments()
  const state = documents.stateFor('a', 'A')
  expect(() => documents.update('b', state)).toThrow()
})

test('章节引用：写出时链接文字是当前生成的文字；只有编辑才写出，失效引用保留原来的链接文字', () => {
  const documents = new ChapterDocuments()
  const original = '见[旧编号](writer:chapter/a)与[原目标](writer:chapter/gone)'
  const state = documents.stateFor('c', original)
  documents.refLabel = (href) =>
    href === 'writer:chapter/a' ? { text: '2.1 方法', id: 'a', name: '2.1 方法' } : null
  // 只是章节树变化：没有新的正文。
  expect(documents.isCurrent('c', original)).toBe(true)
  expect(documents.update('c', typeAtEnd(state, '。'))).toBe(
    '见[2.1 方法](writer:chapter/a)与[原目标](writer:chapter/gone)。',
  )
})

test('采用等价的新正文：状态与撤销历史不变，之后撤销回到它时给出它', () => {
  const documents = new ChapterDocuments()
  const original = '见[旧](writer:chapter/a)'
  const state = documents.stateFor('c', original)
  const label = () => ({ text: '2 方法', id: 'a', name: '2 方法' })
  documents.refLabel = label
  documents.adopt('c', '见[2 方法](writer:chapter/a)')
  expect(documents.isCurrent('c', '见[2 方法](writer:chapter/a)')).toBe(true)
  expect(documents.stateFor('c', '见[2 方法](writer:chapter/a)')).toBe(state)
  const typed = typeAtEnd(state, '。')
  expect(documents.update('c', typed)).toBe('见[2 方法](writer:chapter/a)。')
  expect(documents.update('c', undone(typed))).toBe('见[2 方法](writer:chapter/a)')
})
