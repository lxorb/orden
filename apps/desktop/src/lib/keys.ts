export type Platform = 'mac' | 'win' | 'linux'

export function currentPlatform(): Platform {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Mac|iPhone|iPad|iPod/.test(agent)) return 'mac'
  if (agent.includes('Windows')) return 'win'
  return 'linux'
}

export interface Combination {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  key: string
}

const primary = (platform: Platform) => (platform === 'mac' ? 'meta' : 'ctrl')

export function parseCombination(text: string, platform: Platform): Combination | null {
  if (!text) return null

  const parts = text.split(/-(?!$)/)
  const combination: Combination = {
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: normalizeKey(parts.at(-1) ?? ''),
  }

  if (!combination.key) return null

  for (const modifier of parts.slice(0, -1)) {
    const name = modifier.toLowerCase()
    if (name === 'mod') combination[primary(platform)] = true
    else if (name === 'cmd' || name === 'meta' || name === 'm') combination.meta = true
    else if (name === 'ctrl' || name === 'control' || name === 'c') combination.ctrl = true
    else if (name === 'alt' || name === 'a' || name === 'option') combination.alt = true
    else if (name === 'shift' || name === 's') combination.shift = true
    else return null
  }

  return combination
}

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase()
  if (key === 'Space') return ' '
  return key
}

function writeCombination(combination: Combination, platform: Platform): string {
  const parts: string[] = []
  const mod = primary(platform)

  if (combination[mod]) parts.push('Mod')
  if (mod !== 'ctrl' && combination.ctrl) parts.push('Ctrl')
  if (mod !== 'meta' && combination.meta) parts.push('Meta')
  if (combination.alt) parts.push('Alt')
  if (combination.shift) parts.push('Shift')

  parts.push(combination.key === ' ' ? 'Space' : combination.key)
  return parts.join('-')
}

export function sameCombination(left: string, right: string, platform: Platform): boolean {
  const a = parseCombination(left, platform)
  const b = parseCombination(right, platform)
  if (!a || !b) return false

  return (
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.key === b.key
  )
}

export const PHYSICAL: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
}

for (let digit = 0; digit <= 9; digit++) PHYSICAL[`Digit${digit}`] = String(digit)
for (let letter = 0; letter < 26; letter++) {
  PHYSICAL[`Key${String.fromCharCode(65 + letter)}`] = String.fromCharCode(97 + letter)
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'CapsLock', 'OS', 'Dead'])

export interface Keystroke {
  key: string
  code?: string | undefined
  ctrlKey?: boolean | undefined
  metaKey?: boolean | undefined
  altKey?: boolean | undefined
  shiftKey?: boolean | undefined
  isComposing?: boolean | undefined
}

function held(event: Keystroke) {
  return {
    ctrl: event.ctrlKey ?? false,
    meta: event.metaKey ?? false,
    alt: event.altKey ?? false,
    shift: event.shiftKey ?? false,
  }
}

function unshifted(event: Keystroke): string | undefined {
  return event.code === undefined ? undefined : PHYSICAL[event.code]
}

function typedWithAltGr(event: Keystroke, platform: Platform): boolean {
  const down = held(event)
  return (
    platform === 'win' &&
    down.ctrl &&
    down.alt &&
    !down.meta &&
    !down.shift &&
    event.key.length === 1 &&
    event.key !== ' '
  )
}

export function readCombination(event: Keystroke, platform: Platform): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null

  const down = held(event)
  const physical = unshifted(event)
  const key =
    (down.shift || down.alt) && physical !== undefined && !typedWithAltGr(event, platform)
      ? physical
      : normalizeKey(event.key)
  if (!key) return null

  return writeCombination({ ...down, key }, platform)
}

export function chorded(event: Keystroke): boolean {
  const down = held(event)
  return down.ctrl || down.meta || down.alt
}

function isDigit(key: string): boolean {
  return key.length === 1 && key >= '0' && key <= '9'
}

export function matchesCombination(text: string, event: Keystroke, platform: Platform): boolean {
  if (event.isComposing === true || event.key === 'Process') return false

  const wanted = parseCombination(text, platform)
  if (!wanted) return false

  const down = held(event)
  if (wanted.ctrl !== down.ctrl) return false
  if (wanted.meta !== down.meta) return false
  if (wanted.alt !== down.alt) return false

  const typed = normalizeKey(event.key)
  const underneath = typedWithAltGr(event, platform) ? typed : unshifted(event)

  if (wanted.shift !== down.shift) {
    if (wanted.shift || !isDigit(wanted.key)) return false
    return wanted.key === underneath
  }

  return wanted.key === typed || wanted.key === underneath
}

const SIGNS = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }

const SHOWN: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ' ': 'Space',
  ContextMenu: 'Menu',
}

const SHOWN_MAC: Record<string, string> = {
  Escape: '⎋',
  Delete: '⌦',
  Backspace: '⌫',
  Enter: '↩',
  Tab: '⇥',
  PageUp: '⇞',
  PageDown: '⇟',
  Home: '↖',
  End: '↘',
}

export function showCombination(text: string, platform: Platform): string {
  const twice = /^(\w+) \1$/.exec(text)?.[1]
  const one = twice && showCombination(`${twice}-a`, platform).slice(0, -1).replace(/\+$/, '')
  if (one) return platform === 'mac' ? one + one : `${one} ${one}`

  const combination = parseCombination(text, platform)
  if (!combination) return text

  const key =
    (platform === 'mac' ? SHOWN_MAC[combination.key] : undefined) ??
    SHOWN[combination.key] ??
    (combination.key.length === 1 ? combination.key.toUpperCase() : combination.key)

  if (platform === 'mac') {
    return (
      (combination.ctrl ? SIGNS.ctrl : '') +
      (combination.alt ? SIGNS.alt : '') +
      (combination.shift ? SIGNS.shift : '') +
      (combination.meta ? SIGNS.meta : '') +
      key
    )
  }

  const parts: string[] = []
  if (combination.ctrl) parts.push('Ctrl')
  if (combination.meta) parts.push(platform === 'win' ? 'Win' : 'Super')
  if (combination.alt) parts.push('Alt')
  if (combination.shift) parts.push('Shift')
  parts.push(key)

  return parts.join('+')
}

const KEEPS_ITS_OWN_KEYS = '.xterm, .cm-editor'

const IME_KEY_CODE = 229

interface ImeCoded {
  readonly keyCode?: number
}

function composing(event: KeyboardEvent): boolean {
  const coded: ImeCoded = event
  return event.isComposing || event.key === 'Process' || coded.keyCode === IME_KEY_CODE
}

function plainField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false
  return target.closest(KEEPS_ITS_OWN_KEYS) === null
}

function hold(event: KeyboardEvent) {
  if (composing(event) && plainField(event.target)) event.stopImmediatePropagation()
}

export function holdComposingKeys(within: Window = window): () => void {
  within.addEventListener('keydown', hold, true)
  return () => within.removeEventListener('keydown', hold, true)
}
