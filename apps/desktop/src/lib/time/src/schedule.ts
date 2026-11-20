import { isOwn } from './counted'
import { daysAfter, MINUTE, piecesIn } from './days'
import type { Minute } from './minutes'
import type { Span } from './records'

export type Write = { kind: 'add'; span: Span } | { kind: 'change'; span: Span } | { kind: 'remove'; id: string }
const LEAST_UNSET = 15 * MINUTE
const JOINED = 2 * MINUTE
const untilOf = (span: Span, now: number): number => span.end ?? Math.max(now, span.start)
const blockOf = (start: number, end: number, activity: string | null, id: string = crypto.randomUUID()): Span => ({
  id,
  start,
  end,
  activity,
  tags: [],
  note: '',
  source: 'manual',
  place: null,
  label: null,
  device: null,
})
function cleared(spans: readonly Span[], start: number, end: number, now: number, except: string | null): Write[] {
  const out: Write[] = []
  for (const span of spans) {
    if (!isOwn(span) || span.id === except) continue
    const until = untilOf(span, now)
    if (until <= start || span.start >= end) continue
    const left = span.start < start
    const right = until > end
    if (left && right) {
      out.push({ kind: 'add', span: { ...span, id: crypto.randomUUID(), end: start } })
      out.push({ kind: 'change', span: { ...span, start: end } })
    } else if (left) {
      out.push({ kind: 'change', span: { ...span, end: start } })
    } else if (right) {
      out.push({ kind: 'change', span: { ...span, start: end } })
    } else {
      out.push({ kind: 'remove', id: span.id })
    }
  }
  return out
}
export function takesTime(spans: readonly Span[], writes: readonly Write[], now: number): boolean {
  return writes.some((one) => {
    const id = one.kind === 'remove' ? one.id : one.span.id
    const was = spans.find((span) => span.id === id && isOwn(span))
    if (!was || one.kind === 'add') return false
    if (one.kind === 'remove') return true
    return untilOf(one.span, now) - one.span.start < untilOf(was, now) - was.start
  })
}
export function splitBlock(spans: readonly Span[], id: string, at: number, now: number): Write[] {
  const span = ownOf(spans, id)
  if (!span || !(at > span.start && at < untilOf(span, now))) return []
  return [
    { kind: 'add', span: { ...span, id: crypto.randomUUID(), end: at } },
    { kind: 'change', span: { ...span, start: at } },
  ]
}
export function mergeBlocks(spans: readonly Span[], id: string, other: string, now: number): Write[] {
  const span = ownOf(spans, id)
  const next = ownOf(spans, other)
  if (!span || !next || span.id === next.id) return []
  const start = Math.min(span.start, next.start)
  const running = span.end === null || next.end === null
  const end = Math.max(untilOf(span, now), untilOf(next, now))
  const kept = { ...span, start, end: running ? null : end }
  return [...cleared(spans, start, end, now, id), { kind: 'change', span: kept }]
}
export function placeBlock(
  spans: readonly Span[],
  start: number,
  end: number,
  activity: string | null,
  now: number,
  id?: string,
): Write[] {
  if (!(end > start)) return []
  return [...cleared(spans, start, end, now, null), { kind: 'add', span: blockOf(start, end, activity, id) }]
}
const ownOf = (spans: readonly Span[], id: string): Span | null =>
  spans.find((one) => one.id === id && isOwn(one)) ?? null
export function moveBlock(spans: readonly Span[], id: string, start: number, now: number): Write[] {
  const span = ownOf(spans, id)
  const was = span?.end ?? null
  if (span === null || was === null) return []
  const end = start + was - span.start
  return [...cleared(spans, start, end, now, id), { kind: 'change', span: { ...span, start, end } }]
}
export function resizeBlock(spans: readonly Span[], id: string, start: number, end: number, now: number): Write[] {
  const span = ownOf(spans, id)
  if (!span) return []
  const until = span.end === null ? Math.max(now, span.start) : end
  if (!(until > start)) return []
  const kept = { ...span, start, end: span.end === null ? null : end }
  return [...cleared(spans, start, until, now, id), { kind: 'change', span: kept }]
}
export function setActivity(spans: readonly Span[], id: string, activity: string | null): Write[] {
  const span = ownOf(spans, id)
  return span ? [{ kind: 'change', span: { ...span, activity } }] : []
}
export function removeBlock(spans: readonly Span[], id: string): Write[] {
  return ownOf(spans, id) ? [{ kind: 'remove', id }] : []
}
export interface Stretch {
  from: number
  to: number
  active: number
}
export function unset(
  spans: readonly Span[],
  minutes: readonly Minute[],
  from: number,
  to: number,
  now: number,
  least = LEAST_UNSET,
): Stretch[] {
  const said = piecesIn(spans, from, to, now, isOwn)
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
  return out.filter((one) => one.to - one.from >= least)
}
export interface Slice {
  activity: string | null
  ms: number
}
export interface DayTotals {
  slices: Slice[]
  ms: number
}
export const dayTotals = (spans: readonly Span[], day: number, now: number): DayTotals =>
  scheduleTotals(spans, day, daysAfter(day, 1), now)
export const NOT_SET_LEAST = 5 * MINUTE
export interface RangeTotals extends DayTotals {
  untracked: number
}
export function rangeTotals(
  spans: readonly Span[],
  minutes: readonly Minute[],
  from: number,
  to: number,
  now: number,
  { untracked }: { untracked: boolean },
): RangeTotals {
  const held = scheduleTotals(spans, from, to, now)
  const named = held.slices.filter((one) => one.activity !== null)
  const unnamed = held.slices.find((one) => one.activity === null)?.ms ?? 0
  const loose = untracked
    ? unnamed + unset(spans, minutes, from, to, now, NOT_SET_LEAST).reduce((sum, one) => sum + one.to - one.from, 0)
    : 0
  const slices = loose > 0 ? [...named, { activity: null, ms: loose }] : named
  return { slices, ms: slices.reduce((sum, one) => sum + one.ms, 0), untracked: loose }
}
function scheduleTotals(spans: readonly Span[], start: number, end: number, now: number): DayTotals {
  const pieces = piecesIn(spans, start, end, now, isOwn).filter((one) => one.to > one.from)
  const edges = [...new Set(pieces.flatMap((one) => [one.from, one.to]))].sort((one, other) => one - other)
  const by = new Map<string | null, number>()
  let ms = 0
  for (const [index, from] of edges.entries()) {
    const to = edges[index + 1]
    if (to === undefined) break
    let top: Span | null = null
    for (const piece of pieces) {
      if (piece.from > from || piece.to < to) continue
      if (!top || piece.span.start > top.start || (piece.span.start === top.start && piece.span.id > top.id)) {
        top = piece.span
      }
    }
    if (!top) continue
    by.set(top.activity, (by.get(top.activity) ?? 0) + to - from)
    ms += to - from
  }
  const slices = [...by]
    .map(([activity, held]) => ({ activity, ms: held }))
    .sort(
      (one, other) =>
        other.ms - one.ms ||
        Number(one.activity === null) - Number(other.activity === null) ||
        (one.activity ?? '').localeCompare(other.activity ?? ''),
    )
  return { slices, ms }
}
