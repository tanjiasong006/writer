import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import {
  PATH,
  MOD,
  seededServices,
  mountApp,
  unmountAll,
  rowTexts,
  button,
  editorText,
  appMenuItem,
  focusedChapter,
} from '../../testing/app_harness.ts'

/** 撤销删除章节（ui-spec §23）。 */

afterEach(unmountAll)

async function deleteFirstChapter(wrapper: Awaited<ReturnType<typeof mountApp>>): Promise<void> {
  await wrapper.findAll('.chapter-tree__row')[0].find('.chapter-tree__more').trigger('click')
  await button(wrapper, '删除').trigger('click')
  await button(wrapper, '删除').trigger('click') // 确认（有正文与子章节）
  await flushPromises()
}

test('删除后提示中“撤销”：章节连同子章节与正文回到原位置并被选中，之后保存写回', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await deleteFirstChapter(wrapper)
  expect(rowTexts(wrapper)).toEqual(['1方法'])
  expect(wrapper.find('.workspace__removed').text()).toContain('已删除“绪论”')

  await button(wrapper, '撤销').trigger('click')
  await flushPromises()
  expect(rowTexts(wrapper)).toEqual(['1绪论', '1.1背景', '2方法'])
  expect(wrapper.find('.workspace__removed').exists()).toBe(false)
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('1绪论')
  expect(editorText(wrapper)).toBe('引言')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  const saved = services.storage.committed(PATH)!
  expect(saved.tree.map((node) => node.id)).toEqual(['a', 'b'])
  expect(saved.contents.get('a')).toBe('引言')
})

test('章节树中 ⌘Z 撤销删除，焦点落在恢复的章节上；菜单栏中显示“撤销删除章节”', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await deleteFirstChapter(wrapper)
  ;(wrapper.find('.chapter-tree__row').element as HTMLElement).focus()
  await flushPromises()
  expect(appMenuItem(services, 'chapter:undo-delete').label).toBe('撤销删除章节')

  const event = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...MOD, bubbles: true, cancelable: true })
  document.activeElement!.dispatchEvent(event)
  await flushPromises()
  expect(rowTexts(wrapper)).toEqual(['1绪论', '1.1背景', '2方法'])
  expect(focusedChapter()).toBe('a')
  expect(() => appMenuItem(services, 'chapter:undo-delete')).toThrow()
})
