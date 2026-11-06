import { parseCombination, type Platform } from '../keys'

export const PANE_LETTERS: readonly string[] = ['H', 'J', 'K', 'L']

const ALPHABET = Array.from({ length: 26 }, (_, at) => String.fromCharCode(65 + at))

export function underAlt(key: string | null, platform: Platform): string | null {
  const combination = key === null ? null : parseCombination(key, platform)
  if (!combination?.alt || combination.ctrl || combination.meta || combination.shift) return null
  return combination.key.length === 1 ? combination.key.toUpperCase() : null
}

export function takenUnderAlt(keys: readonly (string | null)[], platform: Platform): Set<string> {
  const taken = new Set(PANE_LETTERS)
  for (const key of keys) {
    const said = underAlt(key, platform)
    if (said !== null && /^[A-Z]$/.test(said)) taken.add(said)
  }
  return taken
}

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
    const own = one.name.normalize('NFD').toUpperCase().match(/[A-Z]/g) ?? []
    const next = [...own, ...ALPHABET].find((letter) => !used.has(letter))
    if (next === undefined) continue
    given[one.path] = next
    used.add(next)
  }
  return given
}
