import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { PATH, MOD, seededServices, mountApp, unmountAll, menuItem, appMenuItem } from '../../testing/app_harness.ts'

/** 章节的写作状态与备注（docs/decisions.md 第 16 节）。 */

afterEach(unmountAll)

async function open() {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  return { services, wrapper }
}

async function save(services: ReturnType<typeof seededServices>) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  return services.storage.committed(PATH)!.tree
}

const popover = () => document.querySelector<HTMLTextAreaElement>('.text-popover__input')

test('节点菜单设置状态：章节树中显示圆点，保存在章节树中；菜单栏中打勾', async () => {
  const { services, wrapper } = await open()
  await wrapper.findAll('.chapter-tree__row')[2].find('.chapter-tree__more').trigger('click')
  await menuItem(wrapper, '待修改').trigger('click')
  await flushPromises()
  const row = wrapper.findAll('.chapter-tree__row')[2]
  expect(row.find('.chapter-tree__status--revise').attributes('title')).toBe('待修改')
  expect((await save(services))[1]).toEqual({ id: 'b', title: '方法', status: 'revise', children: [] })

  await row.trigger('click')
  await flushPromises()
  expect(appMenuItem(services, 'chapter:status-revise').checked).toBe(true)
  services.shell.chooseMenuItem('chapter:status-none')
  await flushPromises()
  expect(wrapper.findAll('.chapter-tree__status')).toHaveLength(0)
})

test('备注：⇧↩ 换行、↩ 完成；章节树中显示标记，编辑器中标题下方显示，单击编辑，清空即去掉', async () => {
  const { services, wrapper } = await open()
  services.shell.chooseMenuItem('chapter:note')
  await flushPromises()
  popover()!.value = '补充数据来源\n核对引用'
  popover()!.dispatchEvent(new Event('input'))
  popover()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
  expect(wrapper.find('.chapter-tree__note').attributes('title')).toBe('补充数据来源\n核对引用')
  expect(wrapper.find('.chapter-editor__note').text()).toBe('补充数据来源\n核对引用')
  expect((await save(services))[0].note).toBe('补充数据来源\n核对引用')

  await wrapper.find('.chapter-editor__note').trigger('click')
  await flushPromises()
  expect(popover()!.value).toBe('补充数据来源\n核对引用')
  popover()!.value = ''
  popover()!.dispatchEvent(new Event('input'))
  popover()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
  expect(wrapper.find('.chapter-editor__note').exists()).toBe(false)
  expect((await save(services))[0]).not.toHaveProperty('note')
})
