import { account } from '../../accounts/src/api'
import { ACCENTS, accentIdFor } from '../../accents'
import { keep, storedText } from '../../stored'
import { isNative, platform } from '../../tauri'
import { browserName } from './browser'
import { appleHandheld } from '../../device'

const KEY = 'orden:device-colour'

const NAMES: Record<string, string> = {
  windows: 'Windows',
  macos: 'Mac',
  linux: 'Linux',
  android: 'Android',
}

export function deviceName(browser: string): string {
  if (!isNative) return browserName(navigator) ?? browser
  if (platform() === 'ios') return appleHandheld()

  return NAMES[platform()] ?? browser
}

export function personName(): string | undefined {
  return account.name ?? undefined
}

export function personFace(): {
  id?: string
  face?: string | undefined
} {
  const user = account.user
  return user ? { id: user.id, face: user.avatar?.s } : {}
}

export function ownAccent(): string {
  const user = account.user
  return user ? accentIdFor(user.id) : deviceAccent()
}

export function deviceAccent(): string {
  const held = storedText(KEY)
  if (held && ACCENTS.some((accent) => accent.id === held)) return held

  const picked = ACCENTS[Math.floor(Math.random() * ACCENTS.length)]?.id ?? ACCENTS[0]?.id ?? ''
  keep(KEY, picked)
  return picked
}
