import { invoke } from '@tauri-apps/api/core'

/**
 * 应用级状态（上次打开的项目、本机界面偏好），保存在应用环境自己的配置目录中（Rust `app_env`）：
 * 正式版 Writer 与开发版 Writer Dev 各有一份，互不可见。
 *
 * 早先的版本把上次打开的项目等保存在网页的 localStorage（键名 `writer.*`）。只有正式版在第一次读取时迁移这些值；
 * 开发版从空状态开始，不会因为 localStorage 中残留的记录而打开正式版的项目。
 */
export interface AppState {
  lastProjectPath: string | null
  preferences: Record<string, string>
}

export interface AppStateSnapshot {
  readonly environment: 'development' | 'production'
  readonly appName: string
  readonly state: string | null
  readonly openProject: string | null
}

/** 早先保存在 localStorage 中的键 → 迁移后的位置。 */
const LEGACY_LAST_PROJECT = 'writer.lastProjectPath'
const LEGACY_PREFERENCES: Readonly<Record<string, string>> = {
  'writer.sidebar-width': 'sidebar-width',
}

export function emptyState(): AppState {
  return { lastProjectPath: null, preferences: {} }
}

/** 解析保存的状态；内容损坏时从空状态开始（应用级状态丢失不影响任何文档）。 */
export function parseState(text: string): AppState {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return emptyState()
    const record = value as Record<string, unknown>
    const preferences: Record<string, string> = {}
    if (typeof record.preferences === 'object' && record.preferences !== null) {
      for (const [key, item] of Object.entries(record.preferences)) {
        if (typeof item === 'string') preferences[key] = item
      }
    }
    return {
      lastProjectPath: typeof record.lastProjectPath === 'string' ? record.lastProjectPath : null,
      preferences,
    }
  } catch {
    return emptyState()
  }
}

/**
 * 启动时的状态：已保存过就用保存的；从未保存过时，正式版迁移 localStorage 中的旧值，开发版从空状态开始。
 * migrated 为 true 时调用方应立即保存一次。
 */
export function initialState(
  snapshot: AppStateSnapshot,
  legacy: Pick<Storage, 'getItem'> | null,
): { state: AppState; migrated: boolean } {
  if (snapshot.state !== null) return { state: parseState(snapshot.state), migrated: false }
  if (snapshot.environment !== 'production' || legacy === null) return { state: emptyState(), migrated: false }
  const state = emptyState()
  const read = (key: string) => {
    try {
      return legacy.getItem(key)
    } catch {
      return null
    }
  }
  state.lastProjectPath = read(LEGACY_LAST_PROJECT)
  for (const [from, to] of Object.entries(LEGACY_PREFERENCES)) {
    const value = read(from)
    if (value !== null) state.preferences[to] = value
  }
  return { state, migrated: true }
}

/** 读取应用环境与应用级状态；返回同步访问状态的对象，修改后按顺序写回。 */
export async function loadAppState() {
  const snapshot = await invoke<AppStateSnapshot>('app_state_read')
  let legacy: Storage | null = null
  try {
    legacy = window.localStorage
  } catch {
    legacy = null
  }
  const { state, migrated } = initialState(snapshot, legacy)
  let writing: Promise<void> = Promise.resolve()

  function persist(): void {
    const text = JSON.stringify(state)
    writing = writing
      .then(() => invoke<void>('app_state_write', { state: text }))
      .catch(() => {
        // 应用级状态只是便利，写入失败不影响文档。
      })
  }

  if (migrated) persist()

  return {
    snapshot,
    getLastProjectPath: (): string | null => state.lastProjectPath,
    setLastProjectPath(path: string | null): void {
      state.lastProjectPath = path
      persist()
    },
    getPreference: (key: string): string | null => state.preferences[key] ?? null,
    setPreference(key: string, value: string): void {
      if (state.preferences[key] === value) return
      state.preferences[key] = value
      persist()
    },
  }
}
