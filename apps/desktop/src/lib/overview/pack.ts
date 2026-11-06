import { COS, N, SIN } from './bubble'
import { gapOf, middleOf, moved, type Outline } from './outline'

export interface Shaped {
  key: string
  outline: Outline
}

export interface Shift {
  x: number
  y: number
}

export function meets(a: Outline, b: Outline, gap: number): boolean {
  return gapOf(a, b) < gap - 0.01
}

const AROUND = 2

export function packed(
  items: readonly Shaped[],
  gap: number,
  taken: readonly Outline[] = [],
  middle: { x: number; y: number } = { x: 0, y: 0 },
  wide = 1,
): Record<string, Shift> {
  const placed: Outline[] = [...taken]
  const out: Record<string, Shift> = {}
  for (const item of items) {
    const own = middleOf(item.outline)
    const best: { shift: Shift | null; off: number } = {
      shift: null,
      off: Number.POSITIVE_INFINITY,
    }
    const tryAt = (shift: Shift) => {
      const off = Math.hypot((own.x + shift.x - middle.x) / wide, own.y + shift.y - middle.y)
      if (off >= best.off - 1e-6) return
      const there = moved(item.outline, shift.x, shift.y)
      if (placed.some((one) => meets(one, there, gap))) return
      best.shift = shift
      best.off = off
    }
    tryAt({ x: middle.x - own.x, y: middle.y - own.y })
    if (!best.shift) {
      for (const one of placed) {
        const centre = middleOf(one)
        const base = { x: centre.x - own.x, y: centre.y - own.y }
        for (let i = 0; i < N; i += AROUND) {
          const c = COS[i] ?? 0
          const s = SIN[i] ?? 0
          const reach =
            gap + (one[i] ?? 0) + (item.outline[(i + N / 2) % N] ?? 0) - (base.x * c + base.y * s)
          tryAt({ x: base.x + c * reach, y: base.y + s * reach })
        }
      }
    }
    const shift = best.shift ?? { x: middle.x - own.x, y: middle.y - own.y }
    placed.push(moved(item.outline, shift.x, shift.y))
    out[item.key] = shift
  }
  return out
}

function clearAlong(pusher: Outline, box: Outline, x: number, y: number, gap: number): number {
  let low = 0
  let high = 64
  while (meets(pusher, moved(box, x * high, y * high), gap) && high < 1e6) high *= 2
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2
    if (meets(pusher, moved(box, x * mid, y * mid), gap)) low = mid
    else high = mid
  }
  return high
}

export function pushedAside(
  held: Outline,
  others: readonly Shaped[],
  gap: number,
  was: Readonly<Record<string, Shift>> = {},
): Record<string, Shift> {
  const from = middleOf(held)
  const now = new Map(others.map(({ key }) => [key, { ...(was[key] ?? { x: 0, y: 0 }) }]))
  const rest = new Map(others.map(({ key, outline }) => [key, outline]))
  const shapeOf = (key: string): Outline | null => {
    const outline = rest.get(key)
    const shift = now.get(key)
    return outline && shift ? moved(outline, shift.x, shift.y) : null
  }
  const far = (key: string) => {
    const shape = shapeOf(key)
    if (!shape) return 0
    const at = middleOf(shape)
    return Math.hypot(at.x - from.x, at.y - from.y)
  }
  const order = others.map(({ key }) => key).sort((a, b) => far(a) - far(b))
  for (let pass = 0; pass <= order.length; pass++) {
    let moving = false
    const pushers: Outline[] = [held]
    for (const key of order) {
      const shift = now.get(key)
      if (!shift) continue
      for (const pusher of pushers) {
        const shape = shapeOf(key)
        if (!shape || !meets(pusher, shape, gap)) continue
        const a = middleOf(pusher)
        const b = middleOf(shape)
        const apart = Math.hypot(b.x - a.x, b.y - a.y)
        const x = apart > 1e-6 ? (b.x - a.x) / apart : 1
        const y = apart > 1e-6 ? (b.y - a.y) / apart : 0
        const by = clearAlong(pusher, shape, x, y, gap)
        shift.x += x * by
        shift.y += y * by
        moving = true
      }
      const shape = shapeOf(key)
      if (shape) pushers.push(shape)
    }
    if (!moving) break
  }
  const out: Record<string, Shift> = {}
  for (const [key, shift] of now)
    if (Math.abs(shift.x) > 0.01 || Math.abs(shift.y) > 0.01) out[key] = shift
  return out
}
