export interface Fold {
  at: number
  rows: number
  grown: number
}

export interface Rows {
  count: number
  height: number
  top: number
  room: number
  overscan: number
  fold?: Fold | null
  pinned?: readonly number[]
}

export interface RowWindow {
  first: number
  last: number
  skip: { from: number; to: number } | null
  above: number
  below: number
  pinned: number[]
}

export interface Place {
  at: number
  away: number | undefined
}

export function scrollerOf(from: HTMLElement): HTMLElement | null {
  for (let box = from.parentElement; box; box = box.parentElement) {
    const flow = getComputedStyle(box).overflowY
    if (flow === 'auto' || flow === 'scroll') return box
  }

  return null
}

export function offsetOf(index: number, rows: Rows): number {
  const { height, fold } = rows
  if (!fold || index <= fold.at) return index * height

  const base = (fold.at + 1) * height
  const band = index - fold.at - 1
  if (band < fold.rows) return base + Math.min(band, fold.grown) * height

  return base + fold.grown * height + (band - fold.rows) * height
}

export function heightOf(index: number, rows: Rows): number {
  const { height, fold } = rows
  if (!fold) return height

  const band = index - fold.at - 1
  if (band < 0 || band >= fold.rows) return height

  return clamp((fold.grown - band) * height, 0, height)
}

export function listHeight(rows: Rows): number {
  const whole = rows.count * rows.height
  if (!rows.fold) return whole

  return whole - (rows.fold.rows - rows.fold.grown) * rows.height
}

export function indexAt(y: number, rows: Rows): number {
  const { count, height, fold } = rows
  if (count <= 0) return 0

  const at = Math.max(0, y)
  const last = count - 1
  if (!fold) return clamp(Math.floor(at / height), 0, last)

  const base = (fold.at + 1) * height
  if (at < base) return clamp(Math.floor(at / height), 0, last)

  const shown = fold.grown * height
  if (at < base + shown) {
    const band = Math.min(Math.floor((at - base) / height), fold.rows - 1)
    return clamp(fold.at + 1 + band, 0, last)
  }

  const under = Math.floor((at - base - shown) / height)
  return clamp(fold.at + fold.rows + 1 + under, 0, last)
}

export function windowFor(rows: Rows): RowWindow {
  if (rows.count <= 0) {
    return { first: 0, last: -1, skip: null, above: 0, below: 0, pinned: [] }
  }

  const last = rows.count - 1
  const first = clamp(indexAt(rows.top, rows) - rows.overscan, 0, last)
  const end = clamp(indexAt(rows.top + Math.max(0, rows.room - 1), rows) + rows.overscan, 0, last)

  const skip = flatBand(first, end, rows)
  const held = [...new Set(rows.pinned ?? [])]
    .filter((one) => one >= 0 && one <= last)
    .filter(
      (one) => one < first || one > end || (skip !== null && one >= skip.from && one <= skip.to),
    )
    .sort((a, b) => a - b)

  return {
    first,
    last: end,
    skip,
    above: offsetOf(first, rows),
    below: Math.max(0, listHeight(rows) - (offsetOf(end, rows) + heightOf(end, rows))),
    pinned: held,
  }
}

function flatBand(first: number, last: number, rows: Rows): { from: number; to: number } | null {
  const fold = rows.fold
  if (!fold) return null

  const from = Math.max(first, fold.at + 1 + Math.ceil(fold.grown))
  const to = Math.min(last, fold.at + fold.rows)

  return from <= to ? { from, to } : null
}

export function autoScrollBy(y: number, room: number, edge: number, most: number): number {
  if (room <= 0 || edge <= 0) return 0

  if (y < edge) return -most * clamp((edge - y) / edge, 0, 1)
  if (y > room - edge) return most * clamp((y - (room - edge)) / edge, 0, 1)

  return 0
}

export function slotsFor(
  held: ReadonlyMap<string, number>,
  keys: readonly string[],
): Map<string, number> {
  const out = new Map<string, number>()
  const numbers = [...held.values()].sort((one, other) => one - other)
  let next = (numbers.at(-1) ?? -1) + 1

  if (keys.some((key) => held.has(key))) {
    for (const key of keys) out.set(key, held.get(key) ?? next++)
    return out
  }

  keys.forEach((key, at) => out.set(key, numbers[at] ?? next++))
  return out
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(Math.max(value, least), most)
}
