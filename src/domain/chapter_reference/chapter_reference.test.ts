import { expect, test } from 'vitest'
import { chapterRefAddress, parseChapterRefAddress } from './chapter_reference.ts'

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
    'writer:figure/a',
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
