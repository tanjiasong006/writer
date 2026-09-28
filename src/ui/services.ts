import { inject, type InjectionKey } from 'vue'
import type { AppServices } from '../application/desktop_shell.ts'

export type { AppServices, DesktopShell } from '../application/desktop_shell.ts'

export const APP_SERVICES: InjectionKey<AppServices> = Symbol('AppServices')

export function useServices(): AppServices {
  const services = inject(APP_SERVICES)
  if (!services) throw new Error('AppServices not provided')
  return services
}
