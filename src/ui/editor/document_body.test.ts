import { expect, test } from 'vitest'
import css from './document_body.css?raw'

test('表头默认不加粗，显式粗体仍保留', () => {
  const style = document.createElement('style')
  style.textContent = css
  const body = document.createElement('div')
  body.className = 'document-body'
  body.innerHTML = '<table><thead><tr><th>普通 <strong>加粗</strong></th></tr></thead></table>'
  document.head.append(style)
  document.body.append(body)
  try {
    const header = body.querySelector('th')!
    expect(getComputedStyle(header).fontWeight).toBe('normal')
    expect(header.querySelector('strong')?.textContent).toBe('加粗')
  } finally {
    style.remove()
    body.remove()
  }
})
