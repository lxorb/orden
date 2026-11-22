import type { InkPoint, InkStroke } from '@orden/markdown/canvas'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}
interface Mark {
  id: string
  from: number
  to: number
  path: (k: number) => [number, number]
}
const STEPS = 160
const ease = (value: number) => value * value * (3 - 2 * value)
const RING: Mark = {
  id: 'ring',
  from: 0.1,
  to: 0.2,
  path: (k) => {
    const turn = Math.PI * 2 * (k * 1.08) - 2.6
    const wobble = 1 + 0.04 * Math.sin(k * 7)
    return [0.31 + 0.078 * wobble * Math.cos(turn), 0.212 + 0.016 * wobble * Math.sin(turn)]
  },
}
const MARKS: readonly Mark[] = [
  RING,
  {
    id: 'line',
    from: 0.27,
    to: 0.33,
    path: (k) => [0.245 + 0.21 * k, 0.347 + 0.004 * Math.sin(k * Math.PI * 2) - 0.002 * k],
  },
  {
    id: 'tick',
    from: 0.4,
    to: 0.445,
    path: (k) => {
      if (k < 0.3) {
        const t = ease(k / 0.3)
        return [0.52 + 0.022 * t, 0.37 + 0.02 * t]
      }
      const t = ease((k - 0.3) / 0.7)
      return [0.542 + 0.07 * t, 0.39 - 0.055 * t - 0.01 * Math.sin(t * Math.PI)]
    },
  },
  {
    id: 'range',
    from: 0.52,
    to: 0.58,
    path: (k) => [0.245 + 0.2 * k, 0.266 + 0.005 * Math.sin(k * Math.PI * 5)],
  },
  {
    id: 'arrow',
    from: 0.65,
    to: 0.72,
    path: (k) => {
      if (k < 0.7) {
        const t = ease(k / 0.7)
        return [0.66 - 0.18 * t, 0.31 - 0.05 * t - 0.02 * Math.sin(t * Math.PI)]
      }
      const t = ease((k - 0.7) / 0.3)
      return [0.48 + 0.025 * t, 0.26 + 0.012 * t]
    },
  },
]
const ERASED = { from: 0.86, to: 0.96 }
function pointsOf(mark: Mark, box: Box, until = 1): InkPoint[] {
  const count = Math.max(2, Math.round(STEPS * until))
  return Array.from({ length: count }, (_, step) => {
    const [u, v] = mark.path((step / (STEPS - 1)) * 1)
    return {
      x: box.x + box.width * u,
      y: box.y + box.height * v,
      pressure: 0.5 + 0.15 * Math.sin((step / STEPS) * Math.PI),
      tiltX: 0,
      tiltY: 0,
      t: step * 6,
    }
  })
}
export function inkAt(
  phase: number,
  box: Box,
  colour: string,
): { strokes: InkStroke[]; drawing: boolean; tip: { x: number; y: number } | null } {
  const stroke = (mark: Mark, points: InkPoint[]): InkStroke => ({
    id: `demo-${mark.id}`,
    tool: 'pen',
    color: colour,
    size: 2.6,
    points,
  })
  const gone = Math.floor(((phase - ERASED.from) / (ERASED.to - ERASED.from)) * MARKS.length)
  const left = phase < ERASED.from ? MARKS.length : Math.max(0, MARKS.length - Math.max(0, gone))
  const strokes: InkStroke[] = []
  let tip: { x: number; y: number } | null = null
  let drawing = false
  for (const [index, mark] of MARKS.entries()) {
    if (index >= left || phase < mark.from) continue
    const done = phase >= mark.to
    const until = done ? 1 : ease((phase - mark.from) / (mark.to - mark.from))
    const points = pointsOf(mark, box, until)
    strokes.push(stroke(mark, points))
    if (!done) {
      drawing = true
      const last = points.at(-1)
      tip = last ? { x: last.x, y: last.y } : null
    }
  }
  if (!drawing && phase >= ERASED.from && phase < ERASED.to) {
    const next = MARKS.at(Math.max(0, left - 1)) ?? RING
    const [u, v] = next.path(0.5)
    tip = { x: box.x + box.width * u, y: box.y + box.height * v }
  }
  return { strokes, drawing, tip }
}
export function nextTip(phase: number, box: Box): { x: number; y: number } {
  const next = MARKS.find((mark) => phase < mark.from) ?? RING
  const [u, v] = next.path(0)
  return { x: box.x + box.width * u, y: box.y + box.height * v }
}
