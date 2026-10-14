import { afterEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import UpdateDialog from './UpdateDialog.vue'
import { createMemoryServices } from '../../testing/memory_services.ts'
import { PATH, seededServices, mountApp, unmountAll, button, typeAtEnd, editorView, appMenuItem } from '../../testing/app_harness.ts'

/** 检查更新（App 与菜单）。 */

afterEach(unmountAll)

function dialogTitle(): string | null {
  return document.querySelector('.update-dialog__title')?.textContent ?? null
}

test('帮助 → 检查更新…：已是最新、未配置、失败时说明，“好”关闭', async () => {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  services.shell.updateResult = { kind: 'up-to-date', current: '0.1.0' }
  const wrapper = await mountApp(services)
  expect(appMenuItem(services, 'app:check-update').label).toBe('检查更新…')

  services.shell.chooseMenuItem('app:check-update')
  await flushPromises()
  expect(dialogTitle()).toBe('Writer 已是最新版本')
  await button(wrapper, '好').trigger('click')
  expect(dialogTitle()).toBeNull()

  services.shell.updateResult = { kind: 'not-configured' }
  services.shell.chooseMenuItem('app:check-update')
  await flushPromises()
  expect(dialogTitle()).toBe('此版本不检查更新')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flushPromises()

  services.shell.updateResult = { kind: 'failed', message: 'network down' }
  services.shell.chooseMenuItem('app:check-update')
  await flushPromises()
  expect(dialogTitle()).toBe('无法检查更新')
  expect(document.querySelector('.update-dialog__detail')?.textContent).toBe('network down')
})

test('检查失败时每个地址（中转站、GitHub）的原因各占一段', async () => {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  services.shell.updateResult = { kind: 'failed', message: 'mirror: connection refused\ngithub: dns error' }
  await mountApp(services)
  services.shell.chooseMenuItem('app:check-update')
  await flushPromises()
  const lines = [...document.querySelectorAll('.update-dialog__detail p')].map(line => line.textContent)
  expect(lines).toEqual(['mirror: connection refused', 'github: dns error'])
})

test('发现新版本：显示说明，下载并安装后重新启动；重新启动前先保存打开的文档', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  services.shell.updateResult = { kind: 'available', current: '0.1.0', version: '0.2.0', notes: '- 查找与替换' }
  const wrapper = await mountApp(services)
  typeAtEnd(editorView(wrapper), '未保存')

  services.shell.chooseMenuItem('app:check-update')
  await flushPromises()
  expect(dialogTitle()).toBe('Writer 0.2.0 可以更新')
  expect(document.querySelector('.update-dialog__notes li')?.textContent).toBe('查找与替换')

  await button(wrapper, '下载并安装').trigger('click')
  await flushPromises()
  expect(services.shell.installs).toBe(1)
  expect(dialogTitle()).toBe('更新已安装')

  await button(wrapper, '重新启动').trigger('click')
  await flushPromises()
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言未保存')
  expect(services.shell.restarts).toBe(1)
})

test('安装失败时说明原因，版本不变', async () => {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  services.shell.updateResult = { kind: 'available', current: '0.1.0', version: '0.2.0', notes: null }
  services.shell.installFailure = 'signature mismatch'
  const wrapper = await mountApp(services)
  services.shell.chooseMenuItem('app:check-update')
  await flushPromises()
  expect(document.querySelector('.update-dialog__notes')).toBeNull()
  await button(wrapper, '下载并安装').trigger('click')
  await flushPromises()
  expect(dialogTitle()).toBe('更新没有安装成功')
  expect(services.shell.restarts).toBe(0)
})

test('启动后在后台检查一次：打开文档时顶栏常驻“更新到”，点击重新检查并打开说明，安装后消失', async () => {
  vi.useFakeTimers()
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.updateResult = { kind: 'available', current: '0.1.0', version: '0.2.0', notes: null }
  const wrapper = await mountApp(services)
  expect(services.shell.updateChecks).toBe(0)
  await vi.advanceTimersByTimeAsync(5000)
  expect(services.shell.updateChecks).toBe(1)
  expect(wrapper.find('.workspace__update').text()).toBe('更新到 0.2.0')

  await wrapper.find('.workspace__update').trigger('click')
  await flushPromises()
  expect(services.shell.updateChecks).toBe(2)
  expect(dialogTitle()).toBe('Writer 0.2.0 可以更新')
  await button(wrapper, '稍后').trigger('click')
  await flushPromises()
  expect(wrapper.find('.workspace__update').exists()).toBe(true)

  // 安装失败后入口仍在，再次点击重新检查并可以再次安装。
  services.shell.installFailure = 'network down'
  await wrapper.find('.workspace__update').trigger('click')
  await flushPromises()
  await button(wrapper, '下载并安装').trigger('click')
  await flushPromises()
  expect(dialogTitle()).toBe('更新没有安装成功')
  await button(wrapper, '好').trigger('click')
  expect(wrapper.find('.workspace__update').exists()).toBe(true)

  services.shell.installFailure = null
  await wrapper.find('.workspace__update').trigger('click')
  await flushPromises()
  await button(wrapper, '下载并安装').trigger('click')
  await flushPromises()
  expect(dialogTitle()).toBe('更新已安装')
  expect(wrapper.find('.workspace__update').exists()).toBe(false)
})

test('欢迎页上后台发现新版本时显示浮条，“查看”打开说明', async () => {
  vi.useFakeTimers()
  const services = createMemoryServices()
  services.shell.updateResult = { kind: 'available', current: '0.1.0', version: '0.2.0', notes: null }
  const wrapper = await mountApp(services)
  await vi.advanceTimersByTimeAsync(5000)
  expect(wrapper.find('.app__update').text()).toContain('Writer 0.2.0 可以更新')

  await button(wrapper, '查看').trigger('click')
  await flushPromises()
  expect(dialogTitle()).toBe('Writer 0.2.0 可以更新')
  expect(wrapper.find('.app__update').exists()).toBe(false)
})

test('后台检查失败或已是最新时不打扰', async () => {
  vi.useFakeTimers()
  const services = createMemoryServices()
  services.shell.updateResult = { kind: 'failed', message: 'offline' }
  const wrapper = await mountApp(services)
  await vi.advanceTimersByTimeAsync(5000)
  expect(services.shell.updateChecks).toBe(1)
  expect(wrapper.find('.app__update').exists()).toBe(false)
  expect(dialogTitle()).toBeNull()
})

test('更新说明按 Markdown 显示：标题、列表、粗体；链接只显示文字，不渲染 HTML', () => {
  const notes = [
    '### 新功能',
    '',
    '- **查找**与替换',
    '- 见 [发布页](https://example.com/releases)',
    '',
    '<img src=x onerror=alert(1)>',
  ].join('\n')
  const wrapper = mount(UpdateDialog, {
    props: { appName: 'Writer', state: { kind: 'available', current: '0.1.0', version: '0.2.0', notes } },
  })
  const box = wrapper.find('.update-dialog__notes')
  expect(box.find('h3').text()).toBe('新功能')
  expect(box.findAll('li').map((item) => item.text())).toEqual(['查找与替换', '见 发布页'])
  expect(box.find('strong').text()).toBe('查找')
  expect(box.find('a').exists()).toBe(false)
  expect(box.find('img').exists()).toBe(false)
  expect(box.text()).toContain('<img src=x onerror=alert(1)>')
  wrapper.unmount()
})

test('更新说明中只给发布页的部分（安装方法等）不显示；只有这部分时不显示说明框', () => {
  const marker = '<!-- writer:release-page-only -->'
  const state = (notes: string) => ({ kind: 'available' as const, current: '0.1.0', version: '0.2.0', notes })
  const wrapper = mount(UpdateDialog, {
    props: { appName: 'Writer', state: state(`### 新功能\n\n- 字数统计\n\n${marker}\n\n### 安装\n\n- 下载 .dmg`) },
  })
  const box = wrapper.find('.update-dialog__notes')
  expect(box.findAll('h3').map((heading) => heading.text())).toEqual(['新功能'])
  expect(box.findAll('li').map((item) => item.text())).toEqual(['字数统计'])
  wrapper.unmount()

  const onlyInstall = mount(UpdateDialog, { props: { appName: 'Writer', state: state(`${marker}\n\n### 安装\n\n- 下载 .dmg`) } })
  expect(onlyInstall.find('.update-dialog__notes').exists()).toBe(false)
  onlyInstall.unmount()
})
