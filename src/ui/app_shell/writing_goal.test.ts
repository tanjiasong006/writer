import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { PATH, seededServices, mountApp, unmountAll, editorView, typeAtEnd, button } from '../../testing/app_harness.ts'

/** 写作目标与今日进度（docs/decisions.md 第 17 节）。 */

afterEach(unmountAll)

test('设置全文目标：显示进度；今天新增的字数随写作增加；目标随项目的界面状态保存', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  await wrapper.find('.workspace__count').trigger('click')
  await flushPromises()
  expect(wrapper.find('.word-count__goal').text()).toContain('今天 +0 字')

  await button(wrapper, '设置全文目标…').trigger('click')
  await wrapper.find('#word-count-goal').setValue('10')
  await wrapper.find('.word-count__goal-form').trigger('submit')
  await flushPromises()
  expect(wrapper.find('.word-count__goal').text()).toContain('目标 10 字')
  expect(wrapper.find('.word-count__goal-percent').text()).toBe('60%')

  typeAtEnd(editorView(wrapper), '新写两个')
  await flushPromises()
  expect(wrapper.find('.word-count__goal').text()).toContain('今天 +4 字')
  expect(wrapper.find('.word-count__goal-percent').text()).toBe('100%')

  await new Promise((resolve) => setTimeout(resolve, 600))
  const saved = JSON.parse(services.shell.uiStates.get(PATH)!)
  expect(saved.goal).toBe(10)
  expect(saved.today.startWords).toBe(6)

  await button(wrapper, '取消目标').trigger('click')
  await flushPromises()
  expect(wrapper.find('.word-count__goal-percent').exists()).toBe(false)
})
