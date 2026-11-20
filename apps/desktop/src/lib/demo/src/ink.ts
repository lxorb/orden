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
  at: (box: Box) => InkPoint[]
}
const point = (x: number, y: number, t: number): InkPoint => ({ x, y, pressure: 0.55, tiltX: 0, tiltY: 0, t })
const inside = (box: Box, u: number, v: number) => ({ x: box.x + box.width * u, y: box.y + box.height * v })
function traced(box: Box, path: (k: number) => [number, number], count: number): InkPoint[] {
  return Array.from({ length: count + 1 }, (_, k) => {
    const [u, v] = path(k / count)
    const at = inside(box, u, v)
    return point(at.x, at.y, k * 12)
  })
}
const MARKS: readonly Mark[] = [
  {
    id: 'ring',
    from: 0.1,
    to: 0.32,
    at: (box) =>
      traced(
        box,
        (k) => [
          0.31 + 0.075 * Math.cos(Math.PI * 2 * k * 1.08 - 0.4),
          0.214 + 0.022 * Math.sin(Math.PI * 2 * k * 1.08 - 0.4),
        ],
        56,
      ),
  },
  {
    id: 'line',
    from: 0.4,
    to: 0.52,
    at: (box) => traced(box, (k) => [0.25 + 0.2 * k, 0.344 + 0.003 * Math.sin(k * 9)], 24),
  },
  {
    id: 'tick',
    from: 0.6,
    to: 0.72,
    at: (box) =>
      traced(
        box,
        (k) => (k < 0.35 ? [0.52 + 0.04 * k, 0.37 + 0.03 * k] : [0.534 + 0.1 * (k - 0.35), 0.3805 - 0.08 * (k - 0.35)]),
        20,
      ),
  },
]
const ERASED = { from: 0.86, to: 0.96 }
export function inkAt(
  phase: number,
  box: Box,
  colour: string,
): { kept: InkStroke[]; live: InkStroke | null; tip: { x: number; y: number } | null } {
  const stroke = (mark: Mark, points: InkPoint[]): InkStroke => ({
    id: `demo-${mark.id}`,
    tool: 'pen',
    color: colour,
    size: 3,
    points,
  })
  const gone = Math.floor(((phase - ERASED.from) / (ERASED.to - ERASED.from)) * MARKS.length)
  const left = phase < ERASED.from ? MARKS.length : Math.max(0, MARKS.length - Math.max(0, gone))
  const kept = MARKS.filter((mark, index) => phase >= mark.to && index < left).map((mark) => stroke(mark, mark.at(box)))
  const going = MARKS.find((mark) => phase >= mark.from && phase < mark.to)
  if (going) {
    const all = going.at(box)
    const shown = all.slice(0, Math.max(2, Math.ceil(all.length * ((phase - going.from) / (going.to - going.from)))))
    const last = shown.at(-1)
    return { kept, live: stroke(going, shown), tip: last ? { x: last.x, y: last.y } : null }
  }
  if (phase >= ERASED.from && phase < ERASED.to) {
    const next = MARKS[Math.min(MARKS.length - 1, Math.max(0, left - 1))]
    const first = next?.at(box)[0]
    return { kept, live: null, tip: first ? { x: first.x, y: first.y } : null }
  }
  return { kept, live: null, tip: null }
}
