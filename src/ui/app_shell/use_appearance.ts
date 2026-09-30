import { ref, type Ref } from 'vue'
import type { Appearance, DesktopShell } from '../../application/desktop_shell.ts'

/**
 * 应用外观（显示 → 外观）：跟随系统、浅色、深色。是本机的界面偏好（应用级状态，见 DesktopShell），
 * 不随项目保存，不影响正文与导出。创建时立即应用保存的外观；配色本身都在 ui/tokens.css。
 */
const KEY = 'appearance'
const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark']

export interface AppearanceState {
  readonly current: Readonly<Ref<Appearance>>
  set(appearance: Appearance): void
}

export function useAppearance(
  shell: Pick<DesktopShell, 'getPreference' | 'setPreference' | 'setAppearance'>,
): AppearanceState {
  const stored = shell.getPreference(KEY)
  const current = ref<Appearance>(APPEARANCES.find((value) => value === stored) ?? 'system')
  shell.setAppearance(current.value)

  function set(appearance: Appearance): void {
    if (appearance === current.value) return
    current.value = appearance
    shell.setPreference(KEY, appearance)
    shell.setAppearance(appearance)
  }

  return { current, set }
}
