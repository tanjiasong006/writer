import { afterEach, expect, test } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import PdfLayoutPreview from './PdfLayoutPreview.vue'
import type { OutputResult } from '../../application/document_output.ts'
import type { PdfLayoutSettings } from '../../domain/pdf_layout/pdf_layout.ts'

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

/** 可控的样张生成：每次调用记录设置，由测试决定何时、以什么结果完成。 */
function controlledPreview() {
  const calls: { settings: PdfLayoutSettings; resolve: (result: OutputResult<readonly string[]>) => void }[] = []
  const preview = (settings: PdfLayoutSettings) =>
    new Promise<OutputResult<readonly string[]>>((resolve) => calls.push({ settings, resolve }))
  return { calls, preview }
}

function render(settings: PdfLayoutSettings, preview: ReturnType<typeof controlledPreview>['preview']) {
  const wrapper = mount(PdfLayoutPreview, { props: { settings, preview } })
  mounted.push(wrapper)
  return wrapper
}

const svg = (paper: string) => `<svg data-paper="${paper}"></svg>`
const pageSources = (wrapper: VueWrapper) => wrapper.findAll('img').map((img) => decodeURIComponent(img.attributes('src')!))

test('结果出来之前是一张按纸张比例的空白页；之后显示各页', async () => {
  const { calls, preview } = controlledPreview()
  const wrapper = render({ paper: 'a5' }, preview)
  expect(calls.map((c) => c.settings)).toEqual([{ paper: 'a5' }])
  const blank = wrapper.find('.preview__page--blank')
  expect(blank.attributes('style')).toContain('aspect-ratio: 148 / 210')
  expect(blank.text()).toBe('正在排版…')

  calls[0].resolve({ ok: true, value: [svg('a5'), svg('a5')] })
  await flushPromises()
  expect(pageSources(wrapper)).toEqual([`data:image/svg+xml;charset=utf-8,${svg('a5')}`, `data:image/svg+xml;charset=utf-8,${svg('a5')}`])
  expect(wrapper.find('.preview__page--blank').exists()).toBe(false)
})

test('排版进行中的多次修改只在完成后按最新设置再排一次，期间保留上一次的页面', async () => {
  const { calls, preview } = controlledPreview()
  const wrapper = render({}, preview)
  calls[0].resolve({ ok: true, value: [svg('a4')] })
  await flushPromises()

  await wrapper.setProps({ settings: { paper: 'b5' } })
  await wrapper.setProps({ settings: { paper: 'a5' } })
  await wrapper.setProps({ settings: { paper: 'letter' } })
  expect(calls).toHaveLength(2)
  expect(wrapper.find('img').classes()).toContain('preview__page--stale')

  // 过时的结果不显示，直接按最新设置重新排版。
  calls[1].resolve({ ok: true, value: [svg('b5')] })
  await flushPromises()
  expect(calls.map((c) => c.settings)).toEqual([{}, { paper: 'b5' }, { paper: 'letter' }])
  expect(pageSources(wrapper)[0]).toContain('a4')

  calls[2].resolve({ ok: true, value: [svg('letter')] })
  await flushPromises()
  expect(pageSources(wrapper)[0]).toContain('letter')
  expect(wrapper.find('img').classes()).not.toContain('preview__page--stale')
})

test('失败时在空白页上说明；缺少中文字体单独说明', async () => {
  const { calls, preview } = controlledPreview()
  const wrapper = render({}, preview)
  calls[0].resolve({ ok: false, error: { code: 'no-cjk-font' } })
  await flushPromises()
  expect(wrapper.find('.preview__page--blank').text()).toBe('缺少中文字体，无法生成样张。')

  await wrapper.setProps({ settings: { toc: false } })
  calls[1].resolve({ ok: false, error: { code: 'render-failed', message: 'x' } })
  await flushPromises()
  expect(wrapper.find('.preview__page--blank').text()).toBe('无法生成样张。')
})

test('点击一页打开全尺寸查看：按 SVG 尺寸以实际大小显示，关闭后回到样张', async () => {
  const { calls, preview } = controlledPreview()
  const wrapper = render({}, preview)
  const page = (n: number) => `<svg viewBox="0 0 ${n} 600" width="${n}pt" height="600pt"></svg>`
  calls[0].resolve({ ok: true, value: [page(420), page(420), page(420)] })
  await flushPromises()
  expect(wrapper.find('img').attributes('style')).toContain('aspect-ratio: 420 / 600')

  await wrapper.findAll('img')[1].trigger('click')
  await flushPromises()
  expect(wrapper.emitted('viewer')).toEqual([[true]])
  const viewer = document.querySelector('.viewer')!
  const pages = viewer.querySelectorAll('img')
  expect(pages).toHaveLength(3)
  // 420pt = 560px。
  expect((pages[0] as HTMLElement).style.width).toBe('560px')
  expect(pages[2].getAttribute('alt')).toBe('第 3 页')

  // 点在页面上不关闭，点在页面以外关闭。
  ;(pages[0] as HTMLElement).click()
  await flushPromises()
  expect(document.querySelector('.viewer')).not.toBeNull()
  ;(viewer.querySelector('.viewer__pages') as HTMLElement).click()
  await flushPromises()
  expect(document.querySelector('.viewer')).toBeNull()
  expect(wrapper.emitted('viewer')).toEqual([[true], [false]])
})
