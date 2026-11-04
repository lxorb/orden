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

/** `count` positions after `before` and before `after`, rising: the gap halved again
 *  and again rather than each one squeezed in after the last, so a hundred rows put in
 *  one gap stay a few digits long. */
export function spread(before: string | null, after: string | null, count: number): string[] {
  if (count <= 0) return []
  const middle = between(before, after)
  const low = Math.floor((count - 1) / 2)
  return [...spread(before, middle, low), middle, ...spread(middle, after, count - 1 - low)]
}

/** The positions that draw a folder's rows in the order `rows` lists them, moving as
 *  few of them as can be: what a drag, a key or an older order turned into positions
 *  sends (#1068). Answers each row whose position changes, by id, and the new one.
 *
 *  The first `placed` rows are the ones somebody put where they are, and stand with
 *  positions; a row after them that already has one keeps standing placed, since
 *  nothing takes a position away, and so does every row before it. The rest follow
 *  the placed in the folder's own order, as they would anyway. Of the rows that stand
 *  placed, the longest run whose positions already rise in the wanted order keeps
 *  them, and only the others are given new ones in the gaps: one row dragged is one
 *  position written, and a drag somebody made elsewhere of another row stands. */
export function repositioned(
  rows: readonly { id: string; pos?: string | undefined }[],
  placed: number,
): Map<string, string> {
  let upTo = Math.min(Math.max(placed, 0), rows.length)
  rows.forEach((row, at) => {
    if (row.pos !== undefined) upTo = Math.max(upTo, at + 1)
  })
  const standing = rows.slice(0, upTo)

  // The longest run of rising positions, by patience: `ends[k]` is where the best run
  // of k + 1 rows found so far ends, its position the lowest such an end can have.
  const ends: number[] = []
  const back = new Array<number>(standing.length).fill(-1)
  standing.forEach((row, at) => {
    const pos = row.pos
    if (pos === undefined) return
    let low = 0
    let high = ends.length
    while (low < high) {
      const mid = (low + high) >> 1
      const end = standing[ends[mid] ?? 0]?.pos ?? ''
      if (end < pos) low = mid + 1
      else high = mid
    }
    back[at] = low > 0 ? (ends[low - 1] ?? -1) : -1
    ends[low] = at
  })
  const keeps = new Set<number>()
  for (let at = ends.at(-1) ?? -1; at >= 0; at = back[at] ?? -1) keeps.add(at)

  const out = new Map<string, string>()
  let before: string | null = null
  let gap: number[] = []
  const fill = (after: string | null) => {
    spread(before, after, gap.length).forEach((pos, k) => {
      const row = standing[gap[k] ?? 0]
      if (row) out.set(row.id, pos)
    })
    gap = []
  }
  standing.forEach((row, at) => {
    if (!keeps.has(at)) {
      gap.push(at)
      return
    }
    fill(row.pos ?? null)
    before = row.pos ?? null
  })
  fill(null)
  return out
}
