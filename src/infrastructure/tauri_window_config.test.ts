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
