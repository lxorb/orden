/** Key combinations: reading them off a keystroke, writing them down, and
 *  showing them to a reader.
 *
 *  One notation throughout, CodeMirror's, because the editor's own keymap
 *  reads it: `Mod-Shift-k`, where `Mod` is Cmd on a Mac and Ctrl everywhere
 *  else. Storing that rather than a resolved `Ctrl-Shift-k` is what lets the
 *  same account carry one choice to a Mac and a PC and have it land on the
 *  key each of them expects.
 *
 *  Nothing here touches the DOM or the app's state, so all of it is testable
 *  with a plain object standing in for a keystroke. */

export type Platform = 'mac' | 'win' | 'linux'

export function currentPlatform(): Platform {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Mac|iPhone|iPad|iPod/.test(agent)) return 'mac'
  if (/Windows/.test(agent)) return 'win'
  return 'linux'
}

export interface Combination {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  /** The key itself, as `KeyboardEvent.key` names it, with letters in lower
   *  case: `k`, `1`, `[`, `Enter`, `ArrowUp`, `F10`. */
  key: string
}

/** Which of Ctrl and Cmd `Mod` means here. */
const primary = (platform: Platform) => (platform === 'mac' ? 'meta' : 'ctrl')

/** Reads a written combination. Null when it is not one - an empty string, or
 *  a modifier nobody knows.
 *
 *  Split the way CodeMirror splits it, on every `-` except a trailing one, so
 *  `Mod--` is Mod and the minus key rather than Mod and nothing. */
export function parseCombination(text: string, platform: Platform): Combination | null {
  if (!text) return null

  const parts = text.split(/-(?!$)/)
  const combination: Combination = {
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: normalizeKey(parts[parts.length - 1]),
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

/** A single letter is written in lower case, so `Mod-K` and `Mod-k` are the
 *  same combination; everything else keeps the name the browser gives it. */
function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase()
  if (key === 'Space') return ' '
  return key
}

/** The combination written the way this app writes them: Mod, then Alt, then
 *  Shift, then the key. What goes to storage and to the account. */
export function writeCombination(combination: Combination, platform: Platform): string {
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

/** Whether two written combinations are the same one. `Mod-Shift-k` and
 *  `Shift-Mod-K` are; so are `Mod-k` and `Ctrl-k` off a Mac. */
export function sameCombination(left: string, right: string, platform: Platform): boolean {
  const a = parseCombination(left, platform)
  const b = parseCombination(right, platform)
  if (!a || !b) return false

  return a.ctrl === b.ctrl && a.meta === b.meta && a.alt === b.alt && a.shift === b.shift && a.key === b.key
}

/** The physical key behind a code, for the shifted characters.
 *
 *  Ctrl+Shift+= arrives as `+`, Ctrl+Shift+3 as `#`, and on a Mac Alt+5
 *  arrives as `[`. What was pressed is the same key either way, and the
 *  written combination names it unshifted, so the code is what to compare. */
const PHYSICAL: Record<string, string> = {
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

/** Just the modifiers, which on their own are not a combination. */
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'CapsLock', 'OS', 'Dead'])

interface Keystroke {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/** What was pressed, written down. Null while only modifiers are held, which
 *  is what the recorder waits through. */
export function readCombination(event: Keystroke, platform: Platform): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null

  const physical = event.code ? PHYSICAL[event.code] : undefined
  // With Shift or Alt down the character on the key is not the key: the
  // combination is named after the key itself.
  const shifted = (event.shiftKey || event.altKey) && physical
  const key = shifted ? physical : normalizeKey(event.key)
  if (!key) return null

  return writeCombination(
    {
      ctrl: !!event.ctrlKey,
      meta: !!event.metaKey,
      alt: !!event.altKey,
      shift: !!event.shiftKey,
      key,
    },
    platform,
  )
}

/** Whether a keystroke is the written combination.
 *
 *  Both names of the key are allowed - the character it produced and the key
 *  it was - so `Mod-Shift-3` answers to Ctrl+Shift+3 on a layout where that
 *  makes a `#` and on one where it makes a `§`. The modifiers have to match
 *  exactly: Ctrl+Alt+S is not Ctrl+S with something extra held down. */
export function matchesCombination(text: string, event: Keystroke, platform: Platform): boolean {
  const wanted = parseCombination(text, platform)
  if (!wanted) return false

  if (wanted.ctrl !== !!event.ctrlKey) return false
  if (wanted.meta !== !!event.metaKey) return false
  if (wanted.alt !== !!event.altKey) return false
  if (wanted.shift !== !!event.shiftKey) return false

  const physical = event.code ? PHYSICAL[event.code] : undefined
  return wanted.key === normalizeKey(event.key) || wanted.key === physical
}

/** How a key reads on a Mac, where modifiers are signs rather than words. */
const SIGNS: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }

/** Names for keys whose own name is too long, or is a word in English that
 *  every keyboard prints as an arrow anyway. */
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
}

/** The combination as a reader sees it: `⌘⇧K` on a Mac, `Ctrl+Shift+K`
 *  everywhere else. An unreadable one comes back as it was written, which is
 *  better than an empty box. */
export function showCombination(text: string, platform: Platform): string {
  const combination = parseCombination(text, platform)
  if (!combination) return text

  const key = SHOWN[combination.key] ?? (combination.key.length === 1 ? combination.key.toUpperCase() : combination.key)

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
  if (combination.meta) parts.push('Meta')
  if (combination.alt) parts.push('Alt')
  if (combination.shift) parts.push('Shift')
  parts.push(key)

  return parts.join('+')
}
