import { type Place, isOwn, placesOf } from './counted'
import { HOUR, MINUTE, piecesIn, type Total, totalsOf, wholeOf } from './days'
import type { Minute } from './minutes'
import { type Lane, LANES, type Span } from './records'

export interface Picked {
  from: number
  to: number
  span: string | null
}

export interface Band {
  key: string
  label: string
  from: number
  to: number
}

const JOINED = 2 * MINUTE

export function bandsOf(
  spans: readonly Span[],
  lane: Lane,
  from: number,
  to: number,
  now: number,
): Band[] {
  const out: Band[] = []
  const mine = spans.filter((span) => span.source === lane && span.place !== null)
  for (const piece of piecesIn(mine, from, to, now)) {
    const key = piece.span.place ?? ''
    const last = [...out].reverse().find((one) => one.key === key)
    if (last && piece.from - last.to <= JOINED && piece.from >= last.from) {
      last.to = Math.max(last.to, piece.to)
      continue
    }
    out.push({ key, label: piece.span.label ?? key, from: piece.from, to: piece.to })
  }
  return out.sort((one, other) => one.from - other.from)
}

export interface Within {
  said: Total[]
  saidMs: number
  active: number
  locked: number
  watched: number
  places: Record<Lane, Place[]>
}

export function within(
  spans: readonly Span[],
  minutes: readonly Minute[],
  from: number,
  to: number,
  now: number,
): Within {
  const said = piecesIn(spans.filter(isOwn), from, to, now)
  const seen = piecesIn(
    spans.filter((span) => !isOwn(span)),
    from,
    to,
    now,
  )
  const inside = minutes.filter((one) => one.at >= from && one.at < to)
  const places = Object.fromEntries(LANES.map((lane) => [lane, placesOf(seen, lane)])) as Record<
    Lane,
    Place[]
  >
  return {
    said: totalsOf(said),
    saidMs: wholeOf(said),
    active: inside.reduce((sum, one) => sum + one.active * 1000, 0),
    locked: inside.filter((one) => one.locked === true || one.lid === false).length * MINUTE,
    watched: inside.length * MINUTE,
    places,
  }
}

export interface Stretch {
  from: number
  to: number
  active: number
}

const LEAST_UNSAID = 15 * MINUTE

export function unsaid(
  spans: readonly Span[],
  minutes: readonly Minute[],
  from: number,
  to: number,
  now: number,
): Stretch[] {
  const said = piecesIn(spans.filter(isOwn), from, to, now)
  const covered = (at: number) => said.some((piece) => piece.from <= at && at < piece.to)
  const out: Stretch[] = []
  let open: Stretch | null = null
  for (const minute of [...minutes].sort((one, other) => one.at - other.at)) {
    if (minute.at < from || minute.at >= to) continue
    const loose = minute.active > 0 && minute.locked !== true && !covered(minute.at)
    if (loose && open && minute.at - open.to <= JOINED) {
      open.to = minute.at + MINUTE
      open.active += minute.active * 1000
    } else if (loose) {
      if (open) out.push(open)
      open = { from: minute.at, to: minute.at + MINUTE, active: minute.active * 1000 }
    }
  }
  if (open) out.push(open)
  return out.filter((one) => one.to - one.from >= LEAST_UNSAID)
}

export function madeOf(
  spans: readonly Span[],
  activity: string | null,
  lane: Lane,
  from: number,
  to: number,
  now: number,
): Place[] {
  const said = piecesIn(
    spans.filter((span) => isOwn(span) && span.activity === activity),
    from,
    to,
    now,
  )
  const seen = spans.filter((span) => span.source === lane)
  const pieces = said.flatMap((one) => piecesIn(seen, one.from, one.to, now))
  return placesOf(pieces, lane)
}

export interface Bucket {
  from: number
  seen: number
  active: number
  away: number
  cpu: number | null
  memory: number | null
  battery: number | null
  charging: boolean
}

const mean = (values: number[]): number | null =>
  values.length ? values.reduce((sum, one) => sum + one, 0) / values.length : null

export function bucketsOf(
  minutes: readonly Minute[],
  from: number,
  to: number,
  size: number,
): Bucket[] {
  const count = Math.max(1, Math.ceil((to - from) / size))
  const held: Minute[][] = Array.from({ length: count }, () => [])
  for (const minute of minutes) {
    if (minute.at < from || minute.at >= to) continue
    held[Math.floor((minute.at - from) / size)]?.push(minute)
  }
  const span = size / MINUTE
  return held.map((inside, index) => {
    const known = <T>(read: (one: Minute) => T | null): T[] =>
      inside.flatMap((one) => {
        const value = read(one)
        return value === null ? [] : [value]
      })
    return {
      from: from + index * size,
      seen: inside.length / span,
      active: inside.reduce((sum, one) => sum + one.active, 0) / 60 / span,
      away: inside.filter((one) => one.locked === true || one.lid === false).length / span,
      cpu: mean(known((one) => one.cpu)),
      memory: mean(known((one) => one.memory)),
      battery: known((one) => one.battery).at(-1) ?? null,
      charging: inside.some((one) => one.charging === true),
    }
  })
}

export function hoursShown(
  from: number,
  to: number,
  moments: readonly number[],
  least: readonly [number, number] = [8, 18],
): [number, number] {
  const inside = moments.filter((one) => one >= from && one <= to)
  const early = inside.reduce((low, one) => Math.min(low, one), from + least[0] * HOUR)
  const late = inside.reduce((high, one) => Math.max(high, one), from + least[1] * HOUR)
  const start = Math.max(from, from + Math.floor((early - from) / HOUR) * HOUR)
  const end = Math.min(to, from + Math.ceil((late - from) / HOUR) * HOUR)
  return [start, Math.max(end, start + HOUR)]
}

export interface Stacked<T> {
  item: T
  row: number
  rows: number
}

export function stacked<T extends { from: number; to: number }>(items: readonly T[]): Stacked<T>[] {
  const sorted = [...items].sort((one, other) => one.from - other.from || other.to - one.to)
  const out: Stacked<T>[] = []
  let cluster: Stacked<T>[] = []
  let ends: number[] = []
  let reach = -Infinity
  const close = () => {
    for (const one of cluster) one.rows = ends.length
    cluster = []
    ends = []
  }
  for (const item of sorted) {
    if (item.from >= reach) close()
    let row = ends.findIndex((end) => end <= item.from)
    if (row === -1) row = ends.push(item.to) - 1
    else ends[row] = item.to
    const placed = { item, row, rows: 1 }
    cluster.push(placed)
    out.push(placed)
    reach = Math.max(reach, item.to)
  }
  close()
  return out
}
