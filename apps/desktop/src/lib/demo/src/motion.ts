import type { Point } from './pointer'

function chance(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}
const NEAR: Record<string, string> = {
  a: 's',
  e: 'r',
  i: 'o',
  o: 'p',
  n: 'm',
  r: 't',
  s: 'd',
  t: 'y',
  l: 'k',
  u: 'i',
  h: 'j',
  d: 'f',
  c: 'v',
  m: 'n',
}
export interface Keys {
  times: number[]
  shown: string[]
  took: number
}
export function keysOf(given: string | readonly string[], seed: number, pace = 1, slips = true): Keys {
  const units = typeof given === 'string' ? Array.from(given) : given
  const draw = chance(seed)
  const times: number[] = [0]
  const shown: string[] = ['']
  let at = 0
  let out = ''
  let lastSlip = -20
  const press = (next: string, gap: number) => {
    at += gap * pace
    out = next
    times.push(at)
    shown.push(out)
  }
  for (let index = 0; index < units.length; index++) {
    const key = units[index] ?? ''
    const before = (units[index - 1] ?? '').slice(-1)
    let gap = 55 + 95 * draw() + (key.length > 1 ? 180 + 160 * draw() : 0)
    if (before === ' ') gap += 40 + 150 * draw()
    if (/[.,:;!?]/.test(before)) gap += 160 + 240 * draw()
    if (before === '\n') gap += 260 + 260 * draw()
    if (/[A-Z#*|$`[\]()]/.test(key)) gap += 50 + 60 * draw()
    const wrong = NEAR[key]
    if (slips && wrong && index - lastSlip > 14 && index > 3 && draw() < 0.06) {
      lastSlip = index
      press(out + wrong, gap)
      const next = units[index + 1] ?? ''
      const extra = draw() < 0.5 && /^[a-z]$/.test(next)
      if (extra) press(out + next, 70 + 60 * draw())
      press(out.slice(0, -1), 260 + 220 * draw())
      if (extra) press(out.slice(0, -1), 70 + 30 * draw())
      gap = 110 + 90 * draw()
    }
    press(out + key, gap)
  }
  return { times, shown, took: at }
}
export function typedAt(keys: Keys, ms: number): string {
  let low = 0
  let high = keys.times.length - 1
  if (ms < 0) return ''
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if ((keys.times[middle] ?? Infinity) <= ms) low = middle
    else high = middle - 1
  }
  return keys.shown[low] ?? ''
}
export interface Move {
  at: number
  to: () => Point | null
  press?: boolean
  drag?: boolean
}
export const PAUSE = 160
const PRESSED = 240
const jerk = (value: number) => value * value * value * (10 + value * (6 * value - 15))
const clampTo = (value: number) => Math.min(1, Math.max(0, value))
const tookFor = (from: Point, to: Point) => 320 + 150 * Math.log2(1 + Math.hypot(to.x - from.x, to.y - from.y) / 40)
function curveAt(from: Point, to: Point, by: number, bend: number): Point {
  const ease = jerk(clampTo(by))
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lift = bend * 0.16 * 4 * ease * (1 - ease)
  return { x: from.x + dx * ease - dy * lift, y: from.y + dy * ease + dx * lift }
}
export function moveAt(ms: number, moves: readonly Move[]): { at: Point | null; press: number } {
  let from = -1
  for (let index = 0; index < moves.length; index++) if ((moves[index]?.at ?? Infinity) <= ms) from = index
  const before = moves[from]
  const after = moves[from + 1]
  const start = before?.to() ?? null
  let at = start
  let press = 0
  if (before && after) {
    const end = after.to()
    const left = before.at + (before.press ? PAUSE + PRESSED * 0.5 : 0)
    if (start && end) {
      const took = Math.min(tookFor(start, end), Math.max(1, after.at - left))
      const by = (ms - (after.at - took)) / took
      at = by <= 0 ? start : curveAt(start, end, by, from % 2 === 0 ? 1 : -1)
    } else at = end ?? start
    if (after.drag && ms >= left) press = 0.55
  }
  if (before?.press) {
    const since = ms - before.at - PAUSE
    if (since >= 0 && since < PRESSED) press = Math.max(press, 1 - since / PRESSED)
  }
  return { at, press }
}
