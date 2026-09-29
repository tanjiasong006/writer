// @vitest-environment node
import { expect, test } from 'vitest'
import { initialState, parseState, type AppStateSnapshot } from './tauri_app_state.ts'

function snapshot(patch: Partial<AppStateSnapshot>): AppStateSnapshot {
  return { environment: 'production', appName: 'Writer', state: null, openProject: null, ...patch }
}

const legacy = {
  getItem: (key: string) =>
    ({ 'writer.lastProjectPath': '/Users/我/Desktop/往事回忆', 'writer.sidebar-width': '300' })[key] ?? null,
}

test('开发版从空状态开始：不读取 localStorage 中残留的上次项目（可能是正式版用过的真实项目）', () => {
  const { state, migrated } = initialState(snapshot({ environment: 'development', appName: 'Writer Dev' }), legacy)
  expect(state.lastProjectPath).toBeNull()
  expect(state.preferences).toEqual({})
  expect(migrated).toBe(false)
})

test('正式版第一次读取时迁移 localStorage 中的上次项目与侧栏宽度，并要求立即保存', () => {
  const { state, migrated } = initialState(snapshot({}), legacy)
  expect(state).toEqual({ lastProjectPath: '/Users/我/Desktop/往事回忆', preferences: { 'sidebar-width': '300' } })
  expect(migrated).toBe(true)
})

test('已经保存过应用级状态时只用保存的内容，不再看 localStorage', () => {
  const saved = JSON.stringify({ lastProjectPath: '/tmp/测试项目', preferences: { 'sidebar-visible': 'false' } })
  const { state, migrated } = initialState(snapshot({ state: saved }), legacy)
  expect(state).toEqual({ lastProjectPath: '/tmp/测试项目', preferences: { 'sidebar-visible': 'false' } })
  expect(migrated).toBe(false)
})

test('保存的状态损坏或类型不对时从空状态开始', () => {
  expect(parseState('{not json')).toEqual({ lastProjectPath: null, preferences: {} })
  expect(parseState('{"lastProjectPath":3,"preferences":{"a":1,"b":"x"}}')).toEqual({
    lastProjectPath: null,
    preferences: { b: 'x' },
  })
})
