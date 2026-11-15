import type { SettingsSectionId } from './shell'

export interface SettingsWindowPort {
  open: boolean
  error: string | null
  at: 'access' | null
  historyOpen: boolean
  show(section?: SettingsSectionId, space?: string | null, landsOnField?: boolean): void
}

export interface SettingsPorts {
  readonly 'settings.window': SettingsWindowPort
}
