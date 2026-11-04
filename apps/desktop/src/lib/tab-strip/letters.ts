/** Which letter each Essential wears while Alt is held, the key that goes to it (#1051):
 *  Alt and a digit is a tab of the strip, Alt and a letter an Essential. What is shown
 *  and when is numbers.svelte.ts, for the digits and the letters alike; this is which
 *  letter. Pure.
 *
 *  **Stable.** A letter once given stays with its Essential (`kept`, written down by
 *  Bookmarks.svelte), so the hand learns it: a new Essential takes a letter nobody has,
 *  and none moves along to make room. A new one's letter is the first of its name's that
 *  is free, then the first of the alphabet's.
 *
 *  **Never a key Alt is already.** H, J, K and L go between panes (#1033), and every key
 *  bound under Alt alone - a reader's own included - is the key's (`takenUnderAlt`). */

import { parseCombination, type Platform } from '../keys'

/** Alt's own between panes, whatever is bound now (#1033). */
export const PANE_LETTERS: readonly string[] = ['H', 'J', 'K', 'L']

const ALPHABET = Array.from({ length: 26 }, (_, at) => String.fromCharCode(65 + at))

/** What a key bound under Alt alone is called: its one character, upper case. Nothing
 *  for a key held with anything else, or a key that is not a character. */
export function underAlt(key: string | null, platform: Platform): string | null {
  const combination = key === null ? null : parseCombination(key, platform)
  if (!combination?.alt || combination.ctrl || combination.meta || combination.shift) return null
  return combination.key.length === 1 ? combination.key.toUpperCase() : null
}

/** Every letter some key bound now holds under Alt alone, and the panes' four. */
export function takenUnderAlt(keys: readonly (string | null)[], platform: Platform): Set<string> {
  const taken = new Set(PANE_LETTERS)
  for (const key of keys) {
    const said = underAlt(key, platform)
    if (said !== null && /^[A-Z]$/.test(said)) taken.add(said)
  }
  return taken
}

/** The letter a key held with Alt alone is, for a jump to an Essential: what it typed
 *  where that is a letter, else the letter at its place on the keyboard. Null for a key
 *  held with anything more, or one that is no letter at all. */
export function letterOf(stroke: {
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
  altGraph: boolean
}): string | null {
  if (!stroke.altKey || stroke.ctrlKey || stroke.shiftKey || stroke.metaKey || stroke.altGraph) {
    return null
  }
  if (/^[a-z]$/i.test(stroke.key)) return stroke.key.toUpperCase()
  return /^Key[A-Z]$/.test(stroke.code) ? stroke.code.slice(3) : null
}

/** The letter of each Essential, by its path: the one it was given before where that is
 *  still free, else the first free letter of its name, else of the alphabet; none where
 *  every letter is taken. */
export function lettersFor(
  essentials: readonly { path: string; name: string }[],
  kept: Readonly<Record<string, string>>,
  taken: ReadonlySet<string>,
): Record<string, string> {
  const given: Record<string, string> = {}
  const used = new Set(taken)

  for (const one of essentials) {
    const before = kept[one.path]
    if (before && /^[A-Z]$/.test(before) && !used.has(before)) {
      given[one.path] = before
      used.add(before)
    }
  }
  for (const one of essentials) {
    if (given[one.path]) continue
    // Its own letters, accents taken off, then the alphabet's.
    const own = one.name.normalize('NFD').toUpperCase().match(/[A-Z]/g) ?? []
    const next = [...own, ...ALPHABET].find((letter) => !used.has(letter))
    if (next === undefined) continue
    given[one.path] = next
    used.add(next)
  }
  return given
}
