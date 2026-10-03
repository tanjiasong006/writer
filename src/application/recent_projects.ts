import type { DesktopShell } from './desktop_shell.ts'

/**
 * 最近打开的项目（应用级状态，Writer 与 Writer Dev 各有一份）：最近的在前，最多 10 个，同一路径只出现一次。
 * 保存在应用偏好中，不进入项目。
 */
export const MAX_RECENT_PROJECTS = 10
const KEY = 'recentProjects'

type Preferences = Pick<DesktopShell, 'getPreference' | 'setPreference'>

export function recentProjects(shell: Preferences): string[] {
  try {
    const value: unknown = JSON.parse(shell.getPreference(KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT_PROJECTS) : []
  } catch {
    return []
  }
}

/** 打开项目后记下它（移到最前面），返回新的列表。 */
export function rememberRecentProject(shell: Preferences, path: string): string[] {
  const next = [path, ...recentProjects(shell).filter((item) => item !== path)].slice(0, MAX_RECENT_PROJECTS)
  shell.setPreference(KEY, JSON.stringify(next))
  return next
}

/** 从列表中去掉（如项目已不存在），返回新的列表。 */
export function forgetRecentProject(shell: Preferences, path: string): string[] {
  const next = recentProjects(shell).filter((item) => item !== path)
  shell.setPreference(KEY, JSON.stringify(next))
  return next
}

export function clearRecentProjects(shell: Preferences): string[] {
  shell.setPreference(KEY, '[]')
  return []
}

/** 列表中显示的名称：文件夹名。 */
export function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}
