import { expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import DocumentPreview from './DocumentPreview.vue'

const html =
  '<h1 class="doc-title">论文</h1>' +
  '<section class="chapter" data-chapter-id="a"><h2 class="chapter-heading">绪论</h2>' +
  '<figure><img data-writer-src="/项目/assets/图.png" alt="图"></figure></section>' +
  '<section class="chapter" data-chapter-id="b"><h2 class="chapter-heading">方法</h2><p>正文</p></section>'

test('图片路径经 toDisplayUrl 转换', async () => {
  const wrapper = mount(DocumentPreview, {
    props: { html, toDisplayUrl: (path: string) => `asset://${path}` },
  })
  await nextTick()
  expect(wrapper.find('img').attributes('src')).toBe('asset:///项目/assets/图.png')
})

test('点击章节内容发出 select', async () => {
  const wrapper = mount(DocumentPreview, { props: { html, toDisplayUrl: (p: string) => p } })
  await wrapper.find('section[data-chapter-id="b"] p').trigger('click')
  expect(wrapper.emitted('select')).toEqual([['b']])
  await wrapper.find('.doc-title').trigger('click')
  expect(wrapper.emitted('select')).toHaveLength(1)
})

test('当前章节变化时滚动到对应章节', async () => {
  const scrolled: string[] = []
  const wrapper = mount(DocumentPreview, {
    attachTo: document.body,
    props: { html, toDisplayUrl: (p: string) => p, activeChapterId: null },
  })
  for (const section of wrapper.findAll('section')) {
    section.element.scrollIntoView = () => scrolled.push((section.element as HTMLElement).dataset.chapterId!)
  }
  await wrapper.setProps({ activeChapterId: 'b' })
  expect(scrolled).toEqual(['b'])
  wrapper.unmount()
})

test('在预览中点击选中章节时不跳动：阅读位置保持不变', async () => {
  const scrolled: string[] = []
  const wrapper = mount(DocumentPreview, {
    attachTo: document.body,
    props: { html, toDisplayUrl: (p: string) => p, activeChapterId: 'a' },
  })
  // 首次显示时定位到当前章节（与本测试无关），等它完成后再记录滚动。
  await nextTick()
  await nextTick()
  for (const section of wrapper.findAll('section')) {
    section.element.scrollIntoView = () => scrolled.push((section.element as HTMLElement).dataset.chapterId!)
  }
  // 点击第 b 章中间的段落 → 上层把选中章节改为 b。
  await wrapper.find('section[data-chapter-id="b"] p').trigger('click')
  await wrapper.setProps({ activeChapterId: 'b' })
  expect(scrolled).toEqual([])

  // 之后从别处（章节树）选中其他章节，仍然滚动过去。
  await wrapper.setProps({ activeChapterId: 'a' })
  expect(scrolled).toEqual(['a'])
  wrapper.unmount()
})
