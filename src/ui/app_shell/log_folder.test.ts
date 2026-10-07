import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createMemoryServices } from '../../testing/memory_services.ts'
import { PATH, seededServices, mountApp, unmountAll, appMenuItem } from '../../testing/app_harness.ts'

/** 帮助 → 显示日志文件夹：欢迎页与工作区中都打开日志文件夹，不检查更新。 */

afterEach(unmountAll)

test('欢迎页：显示日志文件夹', async () => {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  await mountApp(services)
  expect(appMenuItem(services, 'app:show-logs').label).toBe('显示日志文件夹')

  services.shell.chooseMenuItem('app:show-logs')
  await flushPromises()
  expect(services.shell.logFolderReveals).toBe(1)
  expect(services.shell.updateChecks).toBe(0)
})

test('工作区：显示日志文件夹', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  await mountApp(services)

  services.shell.chooseMenuItem('app:show-logs')
  await flushPromises()
  expect(services.shell.logFolderReveals).toBe(1)
  expect(services.shell.updateChecks).toBe(0)
})
