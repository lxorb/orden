/** What this device calls itself in a room, and the colour it wears there.
 *
 *  A room today holds one person's devices, so the useful label on a caret is the
 *  device rather than the person: "that is my phone" is the question two carets in
 *  one note actually raise, and "Emil" on both of them answers nothing. The
 *  colour is the device's own and is kept, so the phone is the same colour every
 *  morning and two machines of the same make are still told apart.
 *
 *  When a space can be shared, a caret will carry the person's name instead and
 *  this becomes the fallback for somebody who has not chosen one. Nothing else
 *  about the room changes; see docs/collaboration.md. */

import { platform } from '@tauri-apps/plugin-os'
import { ACCENTS } from '../accents'
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
