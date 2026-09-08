/** What this device calls itself in a room, and the colour it wears there.
 *
 *  Both names travel and neither is the answer on its own. Two of one person's
 *  own machines want to be told apart by machine - "that is my phone" is the
 *  question two carets in one note raise, and "Emil" on both of them answers
 *  nothing - while two people in a shared space want to be told apart by person.
 *  Which it is depends on who else turns up, so it is decided by whoever is
 *  looking; see rooms/peers.ts.
 *
 *  The colour is the device's own and is kept, so the phone is the same colour
 *  every morning and two machines of the same make are still told apart. */

import { platform } from '@tauri-apps/plugin-os'
import { account } from '../account.svelte'
import { ACCENTS } from '../accents'
import { called } from '../person'
import { isNative } from '../tauri'

const KEY = 'nib:device-colour'

/** Which platform this is, as a person would name it. Proper nouns, so none of
 *  them is translated; the browser is the one that is a word. */
const NAMES: Record<string, string> = {
  windows: 'Windows',
  macos: 'Mac',
  linux: 'Linux',
  android: 'Android',
  ios: 'iPhone',
}

export function deviceName(browser: string): string {
  if (!isNative) return browser

  return NAMES[platform()] ?? browser
}

/** Whoever is at this device, when the account says so. Undefined while signed
 *  out, where there is nobody to name and the device is the whole answer. */
export function personName(): string | undefined {
  return account.user ? called(account.user) : undefined
}

/** One of the accent colours, chosen once for this device and kept. Which one is
 *  random rather than derived from anything: two devices picking their own is how
 *  they end up different, and a name or an id would put every Windows machine on
 *  the same colour. */
export function deviceAccent(): string {
  const held = localStorage.getItem(KEY)
  if (held && ACCENTS.some((accent) => accent.id === held)) return held

  const picked = ACCENTS[Math.floor(Math.random() * ACCENTS.length)]?.id ?? ACCENTS[0]?.id ?? ''
  localStorage.setItem(KEY, picked)
  return picked
}
