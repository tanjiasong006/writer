import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { PATH, seededServices, mountApp, unmountAll, button } from '../../testing/app_harness.ts'

/** 其他导出格式（docs/decisions.md 第 18 节）。 */

afterEach(unmountAll)

test('工具栏导出菜单与“文件 → 导出为其他格式”：选择位置后按格式导出，完成后提示', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  services.shell.exportPath = '/导出/论文.epub'
  const wrapper = await mountApp(services)
  await flushPromises()

  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出为 EPUB…').trigger('click')
  await flushPromises()
  expect(services.output.exports.at(-1)).toMatchObject({ format: 'epub', targetPath: '/导出/论文.epub' })
  expect(wrapper.find('.workspace__notice').text()).toContain('已导出 论文.epub')

  services.shell.exportPath = '/导出/论文.md'
  services.shell.chooseMenuItem('file:export-markdown')
  await flushPromises()
  expect(services.output.exports.at(-1)).toMatchObject({ format: 'markdown', targetPath: '/导出/论文.md' })
  services.shell.chooseMenuItem('file:export-html')
  await flushPromises()
  expect(services.output.exports.at(-1)?.format).toBe('html')
})
