/** Where an entry stands among the others in its folder, when somebody put it there by
 *  hand (#1068): a position, kept on the entry itself and carried with it wherever it
 *  is moved or renamed.
 *
 *  A position is a fractional index: a string of base-62 digits that sorts as plain
 *  text, so a new one fits between any two others without renumbering anything. Two
 *  people who drag rows of one folder at once each move only what they dragged, and
 *  both orders stand; two who drop rows into the same gap get the same position, and
 *  the ids break the tie the same way everywhere.
 *
 *  Never empty and never ending in the lowest digit, so there is always room below. */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** The longest position the account keeps. A drag a day for a lifetime stays far
 *  under it; one past it is a client's mistake. */
export const MOST_POSITION = 128

/** Whether a string is a position. */
export function isPosition(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MOST_POSITION &&
    /^[0-9A-Za-z]+$/.test(value) &&
    !value.endsWith('0')
  )
}

/** A position after `before` and before `after`; either may be null for the end of the
 *  folder. `before` must sort before `after`. */
export function between(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new Error(`no position between ${before} and ${after}`)
  }
  let out = ''
  let upper = after
  for (let at = 0; ; at++) {
    const low = before !== null && at < before.length ? DIGITS.indexOf(before[at] ?? '0') : 0
    const high =
      upper !== null && at < upper.length ? DIGITS.indexOf(upper[at] ?? '0') : DIGITS.length
    if (high - low > 1) return out + (DIGITS[Math.floor((low + high) / 2)] ?? '')
    out += DIGITS[low] ?? '0'
    // Equal so far, the next digit decides; one apart, anything above `before` from
    // here on is already below `after`.
    if (high - low === 1) upper = null
  }
}

/** The order of two entries by position: positioned before unpositioned, then by
 *  position, then by id. */
export function byPosition(
  a: { id: string; pos?: string | undefined },
  b: { id: string; pos?: string | undefined },
): number {
  if (a.pos !== b.pos) {
    if (a.pos === undefined) return 1
    if (b.pos === undefined) return -1
    return a.pos < b.pos ? -1 : 1
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
