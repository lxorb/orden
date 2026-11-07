import { keep, storedText } from './stored'
import { isMobile, isNative, platform } from './tauri'

const STORAGE_KEY = 'orden:device'

const LONGEST = 40

let held: string | null = null

export function appleHandheld(): 'iPhone' | 'iPad' {
  const narrow = typeof screen === 'undefined' ? 0 : Math.min(screen.width, screen.height)
  return narrow > 500 ? 'iPad' : 'iPhone'
}

function worked(): string {
  if (isNative && platform() === 'ios') return appleHandheld()

  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent

  const system = /Windows/i.test(agent)
    ? 'Windows'
    : /Android/i.test(agent)
      ? 'Android'
      : /iPhone|iPad/i.test(agent)
        ? 'iOS'
        : /Mac OS X|Macintosh/i.test(agent)
          ? 'Mac'
          : /Linux/i.test(agent)
            ? 'Linux'
            : ''

  const shape = isNative ? (isMobile ? 'phone' : 'desktop') : 'browser'

  return [system, shape].filter(Boolean).join(' ').slice(0, LONGEST)
}

export function deviceName(): string {
  if (held !== null) return held

  const saved = storedText(STORAGE_KEY)
  if (saved) {
    held = saved.slice(0, LONGEST)
    return held
  }

  held = worked() || 'a device'
  keep(STORAGE_KEY, held)

  return held
}
