import { parseCombination, type Platform } from './ui-kit/src/api'

const NAMED: Readonly<Record<string, string>> = {
  ' ': 'Space',
  Escape: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Pause: 'Pause',
  ScrollLock: 'ScrollLock',
  PrintScreen: 'PrintScreen',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  '-': 'Minus',
  '=': 'Equal',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '`': 'Backquote',
}

export function accelerator(written: string | null, platform: Platform): string | null {
  const combination = parseCombination(written ?? '', platform)
  if (!combination) return null
  if (combination.meta && platform !== 'mac') return null
  const key = combination.key
  const chord = combination.ctrl || combination.meta || combination.alt
  if (!chord && !/^F\d{1,2}$/.test(key)) return null

  const named = /^[a-z]$/.test(key)
    ? key.toUpperCase()
    : /^[0-9]$/.test(key)
      ? `Digit${key}`
      : /^F\d{1,2}$/.test(key)
        ? key
        : NAMED[key]
  if (named === undefined) return null

  return [
    combination.ctrl ? 'Control' : null,
    combination.meta ? 'Super' : null,
    combination.alt ? 'Alt' : null,
    combination.shift ? 'Shift' : null,
    named,
  ]
    .filter((part) => part !== null)
    .join('+')
}
