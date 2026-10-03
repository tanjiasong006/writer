import { expect, test } from 'vitest'
import {
  chapterRefAddress,
  chapterRefText,
  elementLabel,
  elementRefAddress,
  isElementId,
  newElementId,
  parseChapterRefAddress,
} from './chapter_reference.ts'

test('普通链接不是引用', () => {
  expect(parseChapterRefAddress('https://example.com')).toEqual({ kind: 'link' })
  expect(parseChapterRefAddress('')).toEqual({ kind: 'link' })
  // 协议区分大小写：只有小写的 writer: 是 Writer 的地址。
  expect(parseChapterRefAddress('WRITER:chapter/a')).toEqual({ kind: 'link' })
})

test('解析引用与显示格式', () => {
  expect(parseChapterRefAddress('writer:chapter/a1')).toEqual({ kind: 'ref', id: 'a1', show: 'number-title' })
  expect(parseChapterRefAddress('writer:chapter/a1?show=number')).toEqual({ kind: 'ref', id: 'a1', show: 'number' })
  expect(parseChapterRefAddress('writer:chapter/a1?show=title')).toEqual({ kind: 'ref', id: 'a1', show: 'title' })
})

test('未知的显示格式按默认格式', () => {
  expect(parseChapterRefAddress('writer:chapter/a1?show=page')).toEqual({ kind: 'ref', id: 'a1', show: 'number-title' })
  expect(parseChapterRefAddress('writer:chapter/a1?show=')).toEqual({ kind: 'ref', id: 'a1', show: 'number-title' })
})

test('id 按百分号解码', () => {
  expect(parseChapterRefAddress('writer:chapter/%E7%AB%A0%2F1')).toEqual({ kind: 'ref', id: '章/1', show: 'number-title' })
  expect(parseChapterRefAddress('writer:chapter/章')).toEqual({ kind: 'ref', id: '章', show: 'number-title' })
})

test('不符合格式的 writer: 地址是失效引用', () => {
  for (const href of [
    'writer:',
    'writer:figure/a b',
    'writer:figure/',
    'writer:table/a/b',
    'writer:chapter/',
    'writer:chapter/a/b',
    'writer:chapter/a#x',
    'writer:chapter/a?',
    'writer:chapter/a?view=title',
    'writer:chapter/a?show=title&x=1',
    'writer:chapter/%zz',
    'writer:chapter/%+1',
    'writer:chapter/%C3',
    'writer:chapter/%',
    'writer:chapter/?show=title',
  ]) {
    expect(parseChapterRefAddress(href), href).toEqual({ kind: 'malformed' })
  }
})

test('规范写法省略默认格式，并能解析回原值', () => {
  expect(chapterRefAddress('a1', 'number-title')).toBe('writer:chapter/a1')
  expect(chapterRefAddress('a1', 'number')).toBe('writer:chapter/a1?show=number')
  for (const id of ['章/1', 'a?b#c', '%', ' x ']) {
    for (const show of ['number-title', 'number', 'title'] as const) {
      expect(parseChapterRefAddress(chapterRefAddress(id, show))).toEqual({ kind: 'ref', id, show })
    }
  }
})

test('引用文字：按显示格式；不显示编号时只有标题，标题为空时只有编号', () => {
  expect(chapterRefText('2.1', '方法', 'number-title')).toBe('2.1 方法')
  expect(chapterRefText('2.1', '方法', 'number')).toBe('2.1')
  expect(chapterRefText('2.1', '方法', 'title')).toBe('方法')
  expect(chapterRefText(null, '方法', 'number')).toBe('方法')
  expect(chapterRefText('2.1', '', 'title')).toBe('2.1')
  expect(chapterRefText('2.1', '', 'number-title')).toBe('2.1')
})

test('图表引用：writer:figure/<id> 与 writer:table/<id>', () => {
  expect(parseChapterRefAddress('writer:figure/a1')).toEqual({ kind: 'element', element: 'figure', id: 'a1' })
  expect(parseChapterRefAddress('writer:table/x_y-2')).toEqual({ kind: 'element', element: 'table', id: 'x_y-2' })
  expect(parseChapterRefAddress(elementRefAddress('table', 'k9'))).toEqual({ kind: 'element', element: 'table', id: 'k9' })
})

test('图表编号与标识', () => {
  expect(elementLabel('figure', 2, 1)).toBe('图 2-1')
  expect(elementLabel('table', null, 3)).toBe('表 3')
  const id = newElementId(() => 0.5)
  expect(id).toMatch(/^[a-z0-9]{8}$/)
  expect(isElementId(id)).toBe(true)
  expect(isElementId('图')).toBe(false)
})
