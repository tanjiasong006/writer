import { expect, test } from 'vitest'
import type { ImageResolver } from '../editor/image_view.ts'
import { renderChapterBody } from './chapter_body.ts'

function render(text: string, resolve: ImageResolver = (reference) => `asset://${reference}`): HTMLElement {
  const container = document.createElement('div')
  container.append(renderChapterBody(text, resolve))
  return container
}

test('每个顶层块对应一个元素，结构与编辑器相同', () => {
  const body = render('第一段\n\n- 甲\n- 乙\n\n> 引用\n\n| 表头 |\n| --- |\n| 内容 |\n')
  expect([...body.children].map((element) => element.tagName)).toEqual(['P', 'UL', 'BLOCKQUOTE', 'TABLE'])
})

test('Markdown 标题与原始 HTML 是普通文字', () => {
  const body = render('## 研究背景\n\n<b>粗体</b>\n')
  expect(body.querySelector('h2')).toBeNull()
  expect(body.querySelector('b')).toBeNull()
  expect(body.textContent).toBe('## 研究背景<b>粗体</b>')
})

test('独立成段的图片：与编辑器相同的类名，下方是图注；没有图注时不显示', () => {
  const body = render('![系统结构](../assets/a.png)\n\n![](../assets/b.png)\n')
  const [withCaption, withoutCaption] = body.querySelectorAll('.editor-figure')
  expect(withCaption.querySelector('img')!.getAttribute('src')).toBe('asset://../assets/a.png')
  expect(withCaption.querySelector('.editor-figure__caption')!.textContent).toBe('系统结构')
  expect(withoutCaption.querySelector('.editor-figure__caption')).toBeNull()
})

test('行内图片在段落中；无法显示的图片显示占位', () => {
  const body = render('文字 ![图](../assets/a.png) 文字\n\n![远程](https://example.com/a.png)\n', (reference) =>
    reference.startsWith('../') ? `asset://${reference}` : null,
  )
  expect(body.querySelector('p > .editor-image > img')).not.toBeNull()
  expect(body.querySelector('.editor-image__missing')!.textContent).toBe('无法显示图片：远程')
})

test('代码块与编辑器相同地高亮，文字不变', () => {
  const body = render('```js\nconst a = "<x>" // c\n```\n')
  const pre = body.querySelector('pre')!
  expect(pre.dataset.params).toBe('js')
  expect(pre.dataset.language).toBe('JavaScript')
  expect(pre.querySelector('code > .code-keyword')!.textContent).toBe('const')
  expect(pre.querySelector('code > .code-comment')!.textContent).toBe('// c')
  expect(pre.textContent).toBe('const a = "<x>" // c')
})

test('识别不出语言的代码块原样显示', () => {
  const body = render('```\n样本 A → 样本 B\n```\n')
  expect(body.querySelector('pre > code')!.innerHTML).toBe('样本 A → 样本 B')
  expect(body.querySelector('pre')!.hasAttribute('data-language')).toBe(false)
})
