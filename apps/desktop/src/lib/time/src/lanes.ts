import { type Place, isOwn, placesOf } from './counted'
import { HOUR, MINUTE, piecesIn, type Total, totalsOf, wholeOf } from './days'
import type { Minute } from './minutes'
import { type Lane, LANES, type Span } from './records'

export interface Picked {
  from: number
  to: number
}
export const activeIn = (minutes: readonly Minute[], from: number, to: number): number =>
  minutes.reduce((sum, one) => (one.at >= from && one.at < to ? sum + one.active * 1000 : sum), 0)
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
  const said = piecesIn(spans, from, to, now, isOwn)
  const seen = piecesIn(spans, from, to, now, (span) => !isOwn(span))
  const inside = minutes.filter((one) => one.at >= from && one.at < to)
  const places = Object.fromEntries(LANES.map((lane) => [lane, placesOf(seen, lane)])) as Record<Lane, Place[]>
  return {
    said: totalsOf(said),
    saidMs: wholeOf(said),
    active: activeIn(inside, from, to),
    locked: inside.filter((one) => one.locked === true || one.lid === false).length * MINUTE,
    watched: inside.length * MINUTE,
    places,
  }
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
