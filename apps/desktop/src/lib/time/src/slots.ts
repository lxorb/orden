import { piecesIn } from './days'
import type { Minute } from './minutes'
import { type Lane, placeLabel, type Span } from './records'

const SLOT_PX = 4
export interface Bar {
  key: string
  label: string
  from: number
  to: number
  ms: number
}
export interface Level {
  from: number
  to: number
  share: number
}
export const slotsFor = (width: number): number => Math.max(1, Math.floor(width / SLOT_PX))
const STEPS = [5, 10, 15, 30, 60].map((one) => one * 60_000)
const LEAST_STEP_PX = 4
export const snapFor = (width: number, whole: number): number =>
  STEPS.find((one) => width <= 0 || (one / whole) * width >= LEAST_STEP_PX) ?? 60 * 60_000
export function barsOf(
  spans: readonly Span[],
  lane: Lane,
  from: number,
  to: number,
  slots: number,
  now: number,
): Bar[] {
  const size = (to - from) / slots
  const held: Map<string, number>[] = Array.from({ length: slots }, () => new Map<string, number>())
  const labels = new Map<string, string>()
  const mine = (span: Span) => span.source === lane && span.place !== null
  for (const piece of piecesIn(spans, from, to, now, mine)) {
    const key = piece.span.place ?? ''
    if (!labels.has(key)) labels.set(key, placeLabel(piece.span.label, key))
    const first = Math.max(0, Math.floor((piece.from - from) / size))
    const last = Math.min(slots - 1, Math.floor((Math.max(piece.from, piece.to - 1) - from) / size))
    for (let slot = first; slot <= last; slot += 1) {
      const start = from + slot * size
      const ms = Math.min(piece.to, start + size) - Math.max(piece.from, start)
      const bucket = held[slot]
      if (bucket) bucket.set(key, (bucket.get(key) ?? 0) + Math.max(ms, 1))
    }
  }
  const out: Bar[] = []
  for (const [slot, bucket] of held.entries()) {
    let best: string | null = null
    let most = 0
    for (const [key, ms] of bucket) {
      if (ms > most || (ms === most && best !== null && key < best)) {
        best = key
        most = ms
      }
    }
    if (best === null) continue
    const start = from + slot * size
    const last = out.at(-1)
    if (last?.key === best && Math.abs(last.to - start) < 1) {
      last.to = start + size
      last.ms += most
    } else out.push({ key: best, label: labels.get(best) ?? best, from: start, to: start + size, ms: most })
  }
  return out
}
export function levelsOf(minutes: readonly Minute[], from: number, to: number, slots: number): Level[] {
  const size = (to - from) / slots
  const active = new Float64Array(slots)
  const seen = new Uint32Array(slots)
  for (const minute of minutes) {
    if (minute.at < from || minute.at >= to) continue
    const slot = Math.min(slots - 1, Math.floor((minute.at - from) / size))
    active[slot] = (active[slot] ?? 0) + minute.active * 1000
    seen[slot] = (seen[slot] ?? 0) + 1
  }
  const out: Level[] = []
  for (let slot = 0; slot < slots; slot += 1) {
    const count = seen[slot] ?? 0
    if (!count) continue
    const share = Math.min(1, (active[slot] ?? 0) / (count * 60_000))
    out.push({ from: from + slot * size, to: from + (slot + 1) * size, share })
  }
  return out
}
