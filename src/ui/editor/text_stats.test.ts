import { expect, test } from 'vitest'
import { parseMarkdown } from './markdown.ts'
import { chapterRefLabels, NO_CHAPTER_REFS } from './chapter_ref_view.ts'
import { countDoc, countSelection, textOf } from './text_stats.ts'

test('按看到的文字计数：不计 Markdown 记号，图注计入，块之间分开', () => {
  const doc = parseMarkdown('**粗体**与*斜体*\n\n![图注文字](../assets/a.png)\n\n- one\n- two')
  expect(textOf(doc, 0, doc.content.size, NO_CHAPTER_REFS).replace(/\s+/g, ' ').trim()).toBe('粗体与斜体 图注文字 one two')
  expect(countDoc(doc, NO_CHAPTER_REFS)).toEqual({ words: 11, characters: 15 })
})

test('章节引用按显示的文字计数；失效时是链接文字', () => {
  const doc = parseMarkdown('见[旧](writer:chapter/a)与[失效](writer:chapter/zz)')
  const label = chapterRefLabels([{ id: 'a', title: '方法', children: [] }])
  expect(textOf(doc, 0, doc.content.size, label)).toBe('见1 方法与失效')
})

test('选区字数；空选区为 null', () => {
  const doc = parseMarkdown('长文档写作')
  expect(countSelection(doc, 1, 3, NO_CHAPTER_REFS)).toEqual({ words: 2, characters: 2 })
  expect(countSelection(doc, 2, 2, NO_CHAPTER_REFS)).toBeNull()
})
