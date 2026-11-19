import { isReserved } from '@orden/markdown/note-name'

const CONTROL = 0x20

const DELETE = 0x7f

export function insideOnly(said: string): string | null {
  const folded = said.replace(/\\/g, '/').trim()
  if (!folded) return null

  if (folded.startsWith('/') || /^[A-Za-z]:/.test(folded)) return null
  if (holdsUnnameable(folded)) return null

  const steps = folded.split('/').filter((step) => step !== '' && step !== '.')
  if (!steps.length) return null
  if (steps.some((step) => step === '..')) return null
  if (steps.some(isReserved)) return null
  if (onWindows() && steps.some((step) => /[. ]$/.test(step))) return null

  return steps.join('/')
}

const SHORT_NAME = /^([^\s.~]{0,6}~\d{1,6})(\.[^\s.]{1,3})?$/

function shortName(step: string): boolean {
  const base = SHORT_NAME.exec(step.replace(/[. ]+$/, ''))?.[1]
  return base !== undefined && base.length <= 8
}

export const namesByShortName = (path: string): boolean => path.split(/[\\/]/).some(shortName)

function onWindows(): boolean {
  const os = (globalThis as { window?: { __TAURI_OS_PLUGIN_INTERNALS__?: { platform?: string } } }).window
    ?.__TAURI_OS_PLUGIN_INTERNALS__
  return os?.platform === 'windows'
}

function holdsUnnameable(path: string): boolean {
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0
    if (code < CONTROL || code === DELETE) return true
  }

  return false
}
