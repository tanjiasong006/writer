import { expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import DocumentStylePanel from './DocumentStylePanel.vue'
import {
  defaultDocumentStyle,
  overrideStyle,
  selectTheme,
} from '../../domain/document_style/document_style.ts'

test('显示实际生效的值；选择字体、字号、行距发出调整', async () => {
  const wrapper = mount(DocumentStylePanel, { props: { documentStyle: defaultDocumentStyle() } })
  const selects = wrapper.findAll('select')
  expect((selects[0].element as HTMLSelectElement).value).toBe('book')
  expect((selects[1].element as HTMLSelectElement).value).toBe('12')
  expect(wrapper.find('[aria-label="正文字体"] [aria-pressed="true"]').text()).toBe('宋体')
  expect(wrapper.find('[aria-label="标题字体"] [aria-pressed="true"]').text()).toBe('黑体')

  await wrapper.find('[aria-label="正文字体"]').findAll('button')[1].trigger('click')
  await selects[1].setValue('10.5')
  await selects[2].setValue('2')
  await selects[3].setValue('18')
  expect(wrapper.emitted('override')).toEqual([
    [{ bodyFont: 'sans' }],
    [{ bodySize: 10.5 }],
    [{ lineHeight: 2 }],
    [{ heading1Size: 18 }],
  ])
  await selects[0].setValue('technical')
  expect(wrapper.emitted('select-theme')).toEqual([['technical']])
})

test('有调整时可以恢复主题默认；主题切换后显示新主题的值', async () => {
  const wrapper = mount(DocumentStylePanel, { props: { documentStyle: defaultDocumentStyle() } })
  expect(wrapper.find('.style-panel__reset').exists()).toBe(false)
  await wrapper.setProps({ documentStyle: overrideStyle(defaultDocumentStyle(), { bodySize: 14 }) })
  await wrapper.find('.style-panel__reset').trigger('click')
  expect(wrapper.emitted('reset')).toHaveLength(1)

  await wrapper.setProps({ documentStyle: selectTheme(defaultDocumentStyle(), 'technical') })
  expect((wrapper.findAll('select')[1].element as HTMLSelectElement).value).toBe('10.5')
  expect(wrapper.find('[aria-label="正文字体"] [aria-pressed="true"]').text()).toBe('黑体')
})

test('不在选项中的值（手动编辑过项目文件）也能正确显示', () => {
  const wrapper = mount(DocumentStylePanel, {
    props: { documentStyle: overrideStyle(defaultDocumentStyle(), { bodySize: 13 }) },
  })
  expect((wrapper.findAll('select')[1].element as HTMLSelectElement).value).toBe('13')
})
