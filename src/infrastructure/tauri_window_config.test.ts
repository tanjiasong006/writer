// @vitest-environment node
import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const configPath = fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url))

/**
 * Tauri 窗口默认拦截拖放事件用于原生文件拖入，webview 内的 HTML5 拖拽（章节树拖动）因此失效。
 * 这在 happy-dom 的组件测试里无法复现，只能约束配置本身。
 */
test('窗口关闭原生拖放拦截，章节树的 HTML5 拖拽才能生效', () => {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const windows: { dragDropEnabled?: boolean }[] = config.app.windows
  expect(windows.length).toBeGreaterThan(0)
  for (const window of windows) expect(window.dragDropEnabled).toBe(false)
})

/**
 * macOS 窗口的标题栏与工具栏合一（titleBarStyle: Overlay）：窗口只能通过带 data-tauri-drag-region 的区域拖动，
 * 这需要 start-dragging 权限；菜单栏与右键菜单是系统菜单，需要 menu 权限。缺少权限时界面测试无法发现。
 */
test('合一标题栏的窗口可以拖动，系统菜单可用', () => {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const window = config.app.windows[0]
  expect(window.titleBarStyle).toBe('Overlay')
  expect(window.trafficLightPosition).toBeDefined()
  const capability = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../src-tauri/capabilities/default.json', import.meta.url)), 'utf8'),
  )
  expect(capability.permissions).toEqual(expect.arrayContaining(['core:window:allow-start-dragging', 'core:menu:default']))
})
