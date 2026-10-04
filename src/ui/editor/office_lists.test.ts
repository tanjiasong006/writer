import { expect, test } from 'vitest'
import { officeListsToHtml } from './office_lists.ts'

/** Word（Windows）复制出的列表段落：标记在条件注释之间的 mso-list:Ignore span 中。 */
function wordItem(level: number, marker: string, text: string, list = 0): string {
  return (
    `<p class=MsoListParagraph style='margin-left:${level * 21}pt;text-indent:-21pt;mso-list:l${list} level${level} lfo1'>` +
    `<![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>${marker}` +
    `<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>` +
    `<span lang=EN-US>${text}</span><o:p></o:p></p>\n`
  )
}

test('没有列表段落时原样返回', () => {
  const html = '<p>普通段落</p>'
  expect(officeListsToHtml(html)).toBe(html)
})

test('项目符号段落成为 <ul>，编号段落成为 <ol>，标记去掉', () => {
  const html = '<p>前文</p>' + wordItem(1, '·', '甲') + wordItem(1, '·', '乙') + '<p>中间</p>' + wordItem(1, '1.', '一') + wordItem(1, '2.', '二', 0)
  const result = new DOMParser().parseFromString(officeListsToHtml(html), 'text/html').body
  expect(Array.from(result.children).map((child) => child.tagName)).toEqual(['P', 'UL', 'P', 'OL'])
  expect(Array.from(result.querySelectorAll('ul > li')).map((li) => li.textContent)).toEqual(['甲', '乙'])
  expect(Array.from(result.querySelectorAll('ol > li')).map((li) => li.textContent)).toEqual(['一', '二'])
})

test('层级成为嵌套列表；编号从 3 开始时保留起始编号', () => {
  const html = wordItem(1, '3.', '三') + wordItem(2, 'a)', '子一') + wordItem(2, 'b)', '子二') + wordItem(3, '§', '更深') + wordItem(1, '4.', '四')
  const body = new DOMParser().parseFromString(officeListsToHtml(html), 'text/html').body
  const top = body.querySelector('ol')!
  expect(top.getAttribute('start')).toBe('3')
  expect(top.children).toHaveLength(2)
  const nested = top.children[0]!.querySelector('ol')!
  expect(Array.from(nested.children).map((li) => li.querySelector('p')!.textContent)).toEqual(['子一', '子二'])
  expect(nested.children[1]!.querySelector('ul > li')!.textContent).toBe('更深')
})

test('WPS / Mac Word 的注释形式与中文编号', () => {
  const item = (marker: string, text: string) =>
    `<p style="mso-list:l1 level1 lfo2"><!--[if !supportLists]--><span style="mso-list: Ignore">${marker}</span><!--[endif]-->${text}</p>`
  const body = new DOMParser().parseFromString(officeListsToHtml(item('一、', '第一') + item('二、', '第二')), 'text/html').body
  expect(body.innerHTML).not.toContain('一、')
  expect(Array.from(body.querySelectorAll('ol > li')).map((li) => li.textContent)).toEqual(['第一', '第二'])
})
