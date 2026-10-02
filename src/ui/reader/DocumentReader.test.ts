import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import DocumentReader from './DocumentReader.vue'

const tree: ChapterTree = [
  { id: 'a', title: '绪论', children: [{ id: 'a1', title: '', children: [] }] },
  { id: 'b', title: '方法', children: [] },
]

const contents = new Map([
  ['a', '第一段\n\n第二段\n'],
  ['a1', ''],
  ['b', '甲\n\n乙\n\n丙\n'],
])

/**
 * 简单的版面（happy-dom 不排版）：视口顶端在 0；每章是 60 的上留白、40 高的标题，
 * 之后每个正文块高 30、间隔 10。元素的位置随滚动区的 scrollTop 移动。
 */
const PADDING = 60
const HEADING = 40
const BLOCK = 40

function contentTop(element: Element, scroller: Element): { top: number; bottom: number } | null {
  let y = 0
  for (const section of scroller.querySelectorAll('.document-reader__chapter')) {
    const blocks = [...section.querySelector('.document-reader__body')!.children]
    const bodyTop = y + PADDING + HEADING
    const end = bodyTop + blocks.length * BLOCK
    if (element === section) return { top: y, bottom: end }
    if (section.querySelector('.document-reader__heading') === element) return { top: y + PADDING, bottom: bodyTop }
    const index = blocks.indexOf(element)
    if (index >= 0) return { top: bodyTop + index * BLOCK, bottom: bodyTop + index * BLOCK + 30 }
    y = end
  }
  return null
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const scroller = this.closest('.document-reader')
    if (scroller === this || !scroller) return { top: 0, bottom: 600 } as DOMRect
    const box = contentTop(this, scroller) ?? { top: 0, bottom: 0 }
    return { top: box.top - scroller.scrollTop, bottom: box.bottom - scroller.scrollTop } as DOMRect
  })
})

const mounted: VueWrapper[] = []

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})

function mountReader(props: Partial<InstanceType<typeof DocumentReader>['$props']> = {}) {
  const wrapper = mount(DocumentReader, {
    attachTo: document.body,
    props: { tree, contents, activeChapterId: 'a', ...props },
  })
  mounted.push(wrapper)
  return wrapper
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

// a 从 0 开始（正文两块，到 180）；a1 从 180 开始（空正文是一个空段落，到 320）；b 从 320 开始，正文从 420 开始。

test('按阅读顺序连续显示所有章节的编号、标题与正文', () => {
  const wrapper = mountReader()
  expect(wrapper.findAll('.document-reader__heading').map((heading) => heading.text())).toEqual([
    '1绪论',
    '1.1未命名章节',
    '2方法',
  ])
  expect(wrapper.findAll('.document-reader__body').map((body) => body.text())).toEqual(['第一段第二段', '', '甲乙丙'])
})

test('打开时从当前章节开头开始；给出位置时停在同一个块的同一高度，并获得焦点', () => {
  expect(mountReader({ activeChapterId: 'b' }).element.scrollTop).toBe(320)

  const wrapper = mountReader({ activeChapterId: 'b', initialPosition: { chapterId: 'b', block: 1, offset: -10 } })
  expect(wrapper.element.scrollTop).toBe(420 + BLOCK + 10)
  expect(document.activeElement).toBe(wrapper.element)
})

test('滚动时视口顶端所在的章节成为当前章节；回传的当前章节不再引起滚动', async () => {
  const wrapper = mountReader()
  wrapper.element.scrollTop = 200
  await wrapper.trigger('scroll')
  await nextFrame()
  expect(wrapper.emitted('select')).toEqual([['a1']])

  await wrapper.setProps({ activeChapterId: 'a1' })
  expect(wrapper.element.scrollTop).toBe(200)

  wrapper.element.scrollTop = 330
  await wrapper.trigger('scroll')
  await nextFrame()
  expect(wrapper.emitted('select')).toEqual([['a1'], ['b']])
})

test('当前章节从别处改变（章节树中点选）时滚动到该章节开头', async () => {
  const wrapper = mountReader()
  await wrapper.setProps({ activeChapterId: 'b' })
  expect(wrapper.element.scrollTop).toBe(320)
  await wrapper.trigger('scroll')
  await nextFrame()
  expect(wrapper.emitted('select')).toBeUndefined()
})

test('Esc 或 Enter 结束阅读，带上读到的位置', async () => {
  const wrapper = mountReader({ activeChapterId: 'b' })
  wrapper.element.scrollTop = 435
  await wrapper.trigger('keydown', { key: 'Escape' })
  expect(wrapper.emitted('exit')).toEqual([[{ chapterId: 'b', block: 0, offset: -15 }]])

  wrapper.element.scrollTop = 330
  await wrapper.trigger('keydown', { key: 'Enter' })
  expect(wrapper.emitted('exit')![1]).toEqual([{ chapterId: 'b', block: -1, offset: -10 }])

  await wrapper.trigger('keydown', { key: 'Enter', metaKey: true })
  expect(wrapper.emitted('exit')).toHaveLength(2)
})

test('只有正文变化的章节重新生成；标题变化只更新标题', async () => {
  const wrapper = mountReader()
  const firstBlock = () => wrapper.find('.document-reader__body').element.firstElementChild
  const before = firstBlock()

  await wrapper.setProps({
    tree: [{ ...tree[0], title: '引言' }, tree[1]],
    contents: new Map([...contents, ['b', '改写\n']]),
  })
  expect(firstBlock()).toBe(before)
  expect(wrapper.find('.document-reader__heading').text()).toBe('1引言')
  expect(wrapper.findAll('.document-reader__body')[2].text()).toBe('改写')
})

test('章节引用的文字随章节树更新', async () => {
  const wrapper = mountReader({ contents: new Map([['a', '见[旧](writer:chapter/b)'], ['a1', ''], ['b', '']]) })
  const ref = () => wrapper.find('.chapter-ref').text()
  expect(ref()).toBe('2 方法')
  await wrapper.setProps({ tree: [tree[1]!, tree[0]!] })
  expect(ref()).toBe('1 方法')
  await wrapper.setProps({ tree: [{ ...tree[1]!, title: '研究方法' }, tree[0]!] })
  expect(ref()).toBe('1 研究方法')
})
