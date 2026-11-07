import { COS, N, restingOf, SIN } from './bubble'
import type { Box } from './layout'

export type Outline = Float64Array

const at = (o: Outline, i: number) => o[((i % N) + N) % N] ?? 0

export function boxOutline(box: Box): Outline {
  const out = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const c = COS[i] ?? 0
    const s = SIN[i] ?? 0
    out[i] = Math.max(box.x * c, (box.x + box.w) * c) + Math.max(box.y * s, (box.y + box.h) * s)
  }
  return out
}

function joined(...all: readonly (Outline | null)[]): Outline | null {
  const some = all.filter((one): one is Outline => one !== null)
  if (!some.length) return null
  return Float64Array.from({ length: N }, (_, i) =>
    some.map((one) => at(one, i)).reduce((high, one) => Math.max(high, one), -Infinity),
  )
}

export function outlineOf(boxes: readonly Box[], above = 0, wide = 0): Outline | null {
  const bubble = restingOf(boxes)
  if (!bubble || above <= 0) return bubble
  const top = -at(bubble, (3 * N) / 4)
  const middle = (at(bubble, 0) - at(bubble, N / 2)) / 2
  const name = { x: middle - wide / 2, y: top - above, w: wide, h: above }
  return joined(bubble, boxOutline(name))
}

export function moved(o: Outline, x: number, y: number): Outline {
  return Float64Array.from(o, (one, i) => one + x * (COS[i] ?? 0) + y * (SIN[i] ?? 0))
}

export function gapOf(a: Outline, b: Outline): number {
  let widest = Number.NEGATIVE_INFINITY
  for (let i = 0; i < N; i++) widest = Math.max(widest, -at(b, i + N / 2) - at(a, i))
  return widest
}

export function boundsOf(o: Outline): Box {
  const left = -at(o, N / 2)
  const top = -at(o, (3 * N) / 4)
  return { x: left, y: top, w: at(o, 0) - left, h: at(o, N / 4) - top }
}

export function middleOf(o: Outline): { x: number; y: number } {
  const box = boundsOf(o)
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}
