import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { PATH, seededServices, mountApp, unmountAll, appMenuItem, documentTitle } from '../../testing/app_harness.ts'
import { createDocument } from '../../domain/document/document.ts'

/** 最近打开的项目（欢迎页与“文件 → 打开最近”）。 */

afterEach(unmountAll)

const OTHER = '/文稿/读书报告'

function services() {
  const services = seededServices()
  const other = createDocument('读书报告', [{ id: 'r', title: '一', children: [] }], new Map([['r', '']]))
  if (!other.ok) throw new Error('fixture')
  services.storage.seed(OTHER, other.document)
  services.shell.enableAppMenu()
  return services
}

test('打开过的项目记在最近列表中（最近的在前），欢迎页单击即打开', async () => {
  const s = services()
  s.shell.preferences.set('recentProjects', JSON.stringify([OTHER, PATH]))
  const wrapper = await mountApp(s)
  const items = wrapper.findAll('.welcome__recent-item')
  expect(items.map((item) => item.find('.welcome__recent-name').text())).toEqual(['读书报告', '毕业论文'])

  await items[1].trigger('click')
  await flushPromises()
  expect(documentTitle(wrapper)).toBe('毕业论文')
  expect(JSON.parse(s.shell.preferences.get('recentProjects')!)).toEqual([PATH, OTHER])
})

test('文件 → 打开最近：切换到另一个项目；清除菜单', async () => {
  const s = services()
  s.shell.lastProjectPath = PATH
  s.shell.preferences.set('recentProjects', JSON.stringify([PATH, OTHER]))
  const wrapper = await mountApp(s)
  expect(appMenuItem(s, 'file:recent-1').label).toBe('读书报告')

  s.shell.chooseMenuItem('file:recent-1')
  await flushPromises()
  expect(documentTitle(wrapper)).toBe('读书报告')
  expect(appMenuItem(s, 'file:recent-0').label).toBe('读书报告')

  s.shell.chooseMenuItem('file:recent-clear')
  await flushPromises()
  expect(appMenuItem(s, 'file:recent').disabled).toBe(true)
  expect(s.shell.preferences.get('recentProjects')).toBe('[]')
})

test('打不开的项目从列表中去掉，并说明原因', async () => {
  const s = services()
  s.shell.preferences.set('recentProjects', JSON.stringify(['/不存在', PATH]))
  const wrapper = await mountApp(s)
  await wrapper.findAll('.welcome__recent-item')[0].trigger('click')
  await flushPromises()
  expect(wrapper.find('.welcome__error').exists()).toBe(true)
  expect(wrapper.findAll('.welcome__recent-item').map((item) => item.attributes('title'))).toEqual([PATH])
})
