import { isRecord, keepJson, stored } from '../platform/src/api'

const LOCK_WAYS = ['password', 'pin', 'device'] as const
export type LockWay = (typeof LOCK_WAYS)[number]

export const RELOCK_AFTER = [1, 2, 5, 10, 60, 0] as const
export type RelockAfter = (typeof RELOCK_AFTER)[number]

export const CLIPBOARD_CLEAR = [15, 60, 120, 0] as const
export type ClipboardClear = (typeof CLIPBOARD_CLEAR)[number]

export const PAUSES = ['autofill', 'totp', 'suggest', 'save', 'passkeys', 'autoLogin'] as const
export type Pause = (typeof PAUSES)[number]
export type Paused = Record<Pause, boolean>

export interface PassSettings {
  lock: LockWay
  relockAfter: RelockAfter
  clipboardClear: ClipboardClear
  autofill: boolean
  autofillTotp: boolean
  autosave: boolean
  suggest: boolean
  autoLogin: boolean
  copyTotpAfterFill: boolean
  showUsernameField: boolean
  defaultVault: string | null
  checkBreaches: boolean
  paused: Record<string, Paused>
}

const SETTINGS_KEY = 'orden:pass-settings'

const DEFAULT_SETTINGS: PassSettings = {
  lock: 'password',
  relockAfter: 10,
  clipboardClear: 60,
  autofill: true,
  autofillTotp: true,
  autosave: true,
  suggest: true,
  autoLogin: false,
  copyTotpAfterFill: false,
  showUsernameField: false,
  defaultVault: null,
  checkBreaches: false,
  paused: {},
}

type Flag = {
  [K in keyof PassSettings]: PassSettings[K] extends boolean ? K : never
}[keyof PassSettings]

const FLAGS: readonly Flag[] = [
  'autofill',
  'autofillTotp',
  'autosave',
  'suggest',
  'autoLogin',
  'copyTotpAfterFill',
  'showUsernameField',
  'checkBreaches',
]

function oneOf<T>(words: readonly T[], value: unknown, fallback: T): T {
  return words.includes(value as T) ? (value as T) : fallback
}

function pausedIn(value: unknown): Paused | null {
  if (!isRecord(value)) return null
  const paused = Object.fromEntries(PAUSES.map((one) => [one, value[one] === true])) as Paused
  return PAUSES.some((one) => paused[one]) ? paused : null
}

function pausedSitesIn(value: unknown): Record<string, Paused> {
  if (!isRecord(value)) return {}
  const sites: Record<string, Paused> = {}
  for (const [site, one] of Object.entries(value)) {
    const paused = pausedIn(one)
    if (paused) sites[site] = paused
  }
  return sites
}

function settingsIn(value: unknown): PassSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS, paused: {} }
  const settings: PassSettings = {
    ...DEFAULT_SETTINGS,
    lock: oneOf(LOCK_WAYS, value.lock, DEFAULT_SETTINGS.lock),
    relockAfter: oneOf(RELOCK_AFTER, value.relockAfter, DEFAULT_SETTINGS.relockAfter),
    clipboardClear: oneOf(CLIPBOARD_CLEAR, value.clipboardClear, DEFAULT_SETTINGS.clipboardClear),
    defaultVault: typeof value.defaultVault === 'string' ? value.defaultVault : null,
    paused: pausedSitesIn(value.paused),
  }
  for (const flag of FLAGS) {
    const given = value[flag]
    if (typeof given === 'boolean') settings[flag] = given
  }
  return settings
}

export function readSettings(): PassSettings {
  return settingsIn(stored(SETTINGS_KEY))
}

export function keepSettings(settings: PassSettings): void {
  keepJson(SETTINGS_KEY, settings)
}
