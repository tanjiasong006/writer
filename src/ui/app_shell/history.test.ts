import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { PATH, MOD, seededServices, mountApp, unmountAll, button, editorView, typeAtEnd, editorText, rowTexts } from '../../testing/app_harness.ts'

/** 版本历史（docs/project-format.md 第 7.1 节）。 */

afterEach(unmountAll)

async function open() {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  return { services, wrapper }
}

const items = () => [...document.querySelectorAll('.history__item')].map((item) => item.querySelector('.history__name')!.textContent)

test('打开文档时自动留下一个版本；一天之内再次打开不重复', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.storage.now = Date.now()
  await mountApp(services)
  await flushPromises()
  expect(services.storage.snapshots.get(PATH)?.map((entry) => entry.info.kind)).toEqual(['auto'])
  unmountAll()
  await mountApp(services)
  await flushPromises()
  expect(services.storage.snapshots.get(PATH)).toHaveLength(1)
})

test('保存当前版本：先保存修改，再留下命名的版本，列表中最新的在前', async () => {
  const { services, wrapper } = await open()
  typeAtEnd(editorView(wrapper), '修改')
  services.shell.chooseMenuItem('file:history')
  await flushPromises()
  expect(items()).toEqual(['自动保存'])
  await wrapper.find('.history__label').setValue('初稿')
  await wrapper.find('.history__create').trigger('submit')
  await flushPromises()
  expect(items()).toEqual(['初稿', '自动保存'])
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言修改')
  expect(services.storage.snapshots.get(PATH)!.at(-1)!.state.document.contents.get('a')).toBe('引言修改')
})

test('恢复版本：确认后先留下当前版本，再把选中的版本作为一次修改恢复并保存', async () => {
  const { services, wrapper } = await open()
  // 自动版本是修改之前的内容；修改并删除一个章节后恢复它。
  typeAtEnd(editorView(wrapper), '之后的修改')
  await wrapper.findAll('.chapter-tree__row')[2].find('.chapter-tree__more').trigger('click')
  await button(wrapper, '删除').trigger('click')
  await button(wrapper, '删除').trigger('click')
  await flushPromises()
  expect(rowTexts(wrapper)).toEqual(['1绪论', '1.1背景'])

  services.shell.chooseMenuItem('file:history')
  await flushPromises()
  ;(document.querySelector('.history__item') as HTMLElement).click()
  await flushPromises()
  await button(wrapper, '恢复此版本…').trigger('click')
  await flushPromises()
  expect(services.shell.confirmations.at(-1)).toContain('当前内容会先保存为一个版本')
  expect(wrapper.find('.history').exists()).toBe(false)
  expect(rowTexts(wrapper)).toEqual(['1绪论', '1.1背景', '2方法'])
  expect(editorText(wrapper)).toBe('引言')
  expect(services.storage.snapshots.get(PATH)!.map((entry) => entry.info.kind)).toEqual(['auto', 'before-restore'])

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.contents.get('b')).toBe('方法正文')
})

test('删除版本；取消恢复不改变内容', async () => {
  const { services, wrapper } = await open()
  services.shell.chooseMenuItem('file:history')
  await flushPromises()
  ;(document.querySelector('.history__item') as HTMLElement).click()
  await flushPromises()
  services.shell.confirmAnswer = false
  await button(wrapper, '恢复此版本…').trigger('click')
  await flushPromises()
  expect(services.storage.snapshots.get(PATH)).toHaveLength(1)
  await button(wrapper, '删除').trigger('click')
  await flushPromises()
  expect(document.querySelector('.history__empty')?.textContent).toBe('还没有保存过版本。')
})
