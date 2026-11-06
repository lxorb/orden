const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export const MOST_POSITION = 128

export function isPosition(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MOST_POSITION &&
    /^[0-9A-Za-z]+$/.test(value) &&
    !value.endsWith('0')
  )
}

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
    if (high - low === 1) upper = null
  }
}

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

export function spread(before: string | null, after: string | null, count: number): string[] {
  if (count <= 0) return []
  const middle = between(before, after)
  const low = Math.floor((count - 1) / 2)
  return [...spread(before, middle, low), middle, ...spread(middle, after, count - 1 - low)]
}

export function repositioned(
  rows: readonly { id: string; pos?: string | undefined }[],
  placed: number,
): Map<string, string> {
  let upTo = Math.min(Math.max(placed, 0), rows.length)
  rows.forEach((row, at) => {
    if (row.pos !== undefined) upTo = Math.max(upTo, at + 1)
  })
  const standing = rows.slice(0, upTo)

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
