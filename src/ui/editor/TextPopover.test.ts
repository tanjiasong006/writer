import { afterEach, expect, test } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import TextPopover from './TextPopover.vue'

/** 短文字浮层（脚注、表格标题、章节备注）的“完成”与“取消”按钮。 */

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function open(text: string, multiline = false) {
  const wrapper = mount(TextPopover, {
    attachTo: document.body,
    props: { anchor: { x: 100, y: 100 }, label: '脚注 1', text, placeholder: '脚注内容', multiline },
  })
  mounted.push(wrapper)
  return wrapper
}

test('点击“完成”与按 Enter 相同：换行替换为空格', async () => {
  const wrapper = open('甲')
  await wrapper.find('.text-popover__input').setValue('第一行\n第二行')
  await wrapper.find('.text-popover__action.is-default').trigger('click')
  expect(wrapper.emitted('commit')).toEqual([['第一行 第二行']])
})

test('点击“取消”放弃修改', async () => {
  const wrapper = open('甲')
  await wrapper.find('.text-popover__input').setValue('乙')
  await wrapper.findAll('.text-popover__action')[0].trigger('click')
  expect(wrapper.emitted('cancel')).toHaveLength(1)
  expect(wrapper.emitted('commit')).toBeUndefined()
})

test('多行内容才提示 ⇧↩ 换行', () => {
  expect(open('').find('.text-popover__hint').exists()).toBe(false)
  expect(open('', true).find('.text-popover__hint').text()).toBe('⇧↩ 换行')
})
