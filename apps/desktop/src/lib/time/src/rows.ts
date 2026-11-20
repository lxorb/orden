import { isOwn } from './counted'
import { daysAfter, MINUTE, piecesIn } from './days'
import type { Minute } from './minutes'
import type { Span } from './records'
import { NOT_SET_LEAST, unset } from './schedule'

export type Row =
  | { kind: 'block'; span: Span; from: number; to: number }
  | { kind: 'unset'; from: number; to: number; active: number }
  | { kind: 'gap'; from: number; to: number }
  | { kind: 'night'; from: number; to: number }
export interface Day {
  day: number
  rows: Row[]
}
const GAP_LEAST = 5 * MINUTE
const NIGHT = 3 * 60 * MINUTE
function dayRows(
  spans: readonly Span[],
  minutes: readonly Minute[],
  day: number,
  now: number,
  untracked: boolean,
): Row[] {
  const next = daysAfter(day, 1)
  const items: Row[] = [
    ...piecesIn(spans, day, next, now, isOwn)
      .filter((one) => one.to > one.from || one.span.end === null)
      .map((one): Row => ({ kind: 'block', span: one.span, from: one.from, to: one.to })),
    ...(untracked
      ? unset(spans, minutes, day, next, now, NOT_SET_LEAST).map((one): Row => ({
          kind: 'unset',
          from: one.from,
          to: Math.min(one.to, now),
          active: one.active,
        }))
      : []),
  ].sort((one, other) => one.from - other.from)
  const out: Row[] = []
  for (const item of items) {
    const last = out.at(-1)
    if (last && item.from - last.to >= GAP_LEAST) {
      out.push({ kind: item.from - last.to > NIGHT ? 'night' : 'gap', from: last.to, to: item.from })
    }
    out.push(item)
  }
  return out
}
export function daysOf(
  spans: readonly Span[],
  minutes: readonly Minute[],
  from: number,
  to: number,
  now: number,
  untracked: boolean,
): Day[] {
  const out: Day[] = []
  for (let day = from; day < to && day <= now; day = daysAfter(day, 1)) {
    const rows = dayRows(spans, minutes, day, now, untracked)
    const busy = minutes.some((one) => one.active > 0 && one.at >= day && one.at < daysAfter(day, 1))
    if (rows.length || busy) out.push({ day, rows })
  }
  return out.reverse()
}
