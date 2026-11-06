import { type Frame, panesIn } from '../workspace/pane-tree'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Slot extends Box {
  id: string
  paneId: string
}

export interface Seam {
  id: string
  along: 'row' | 'column'
  from: { x: number; y: number }
  to: { x: number; y: number }
}

export interface Laid {
  slots: Slot[]
  seams: Seam[]
}

export interface Panes {
  tabsOf: (paneId: string) => readonly string[]
  shapeOf: (paneId: string) => number
  named?: number
}

const GAP = 28
const ROW_GAP = 60
const SEAM_GAP = 56

export const WIDEST = 0.46

function shareOf(first: number, second: number): number {
  const a = Math.sqrt(Math.max(first, 1))
  const b = Math.sqrt(Math.max(second, 1))
  return Math.min(0.7, Math.max(0.3, a / (a + b)))
}

function countIn(frame: Frame, panes: Panes): number {
  if (frame.kind === 'pane') return panes.tabsOf(frame.id).length
  return countIn(frame.sides[0], panes) + countIn(frame.sides[1], panes)
}

export function gridFor(count: number, shape: number, room: Box, widest: number, rowGap = ROW_GAP) {
  let best = { across: 1, w: 0 }
  for (let across = 1; across <= Math.max(count, 1); across++) {
    const down = Math.ceil(count / across)
    const byWidth = (room.w - (across - 1) * GAP) / across
    const byHeight = ((room.h - (down - 1) * rowGap) / down) * shape
    const w = Math.min(byWidth, byHeight, widest)
    if (w > best.w + 0.5) best = { across, w }
  }
  return best
}

function grid(paneId: string, room: Box, panes: Panes, widest: number): Slot[] {
  const ids = panes.tabsOf(paneId)
  const shape = panes.shapeOf(paneId)
  const rowGap = Math.max(ROW_GAP, panes.named ?? 0)
  const { across, w } = gridFor(ids.length, shape, room, widest, rowGap)
  const h = w / shape
  const down = Math.ceil(ids.length / across)
  const tall = down * h + (down - 1) * rowGap
  const top = room.y + (room.h - tall) / 2

  return ids.map((id, index) => {
    const row = Math.floor(index / across)
    const inRow = row === down - 1 ? ids.length - row * across : across
    const wide = inRow * w + (inRow - 1) * GAP
    const left = room.x + (room.w - wide) / 2
    return {
      id,
      paneId,
      x: left + (index % across) * (w + GAP),
      y: top + row * (h + rowGap),
      w,
      h,
    }
  })
}

export function around(slots: readonly Box[]): Box | null {
  if (!slots.length) return null
  const x = Math.min(...slots.map((one) => one.x))
  const y = Math.min(...slots.map((one) => one.y))
  const right = Math.max(...slots.map((one) => one.x + one.w))
  const bottom = Math.max(...slots.map((one) => one.y + one.h))
  return { x, y, w: right - x, h: bottom - y }
}

function layIn(frame: Frame, room: Box, panes: Panes, widest: number): Laid {
  if (frame.kind === 'pane') {
    return {
      slots: grid(frame.id, room, panes, widest),
      seams: [],
    }
  }

  const [first, second] = frame.sides
  const share = shareOf(countIn(first, panes), countIn(second, panes))
  const across = frame.along === 'row'
  const length = (across ? room.w : room.h) - SEAM_GAP
  const one = length * share
  const a: Box = across ? { ...room, w: one } : { ...room, h: one }
  const b: Box = across
    ? { ...room, x: room.x + one + SEAM_GAP, w: length - one }
    : { ...room, y: room.y + one + SEAM_GAP, h: length - one }

  const left = layIn(first, a, panes, widest)
  const right = layIn(second, b, panes, widest)
  const slots = [...left.slots, ...right.slots]
  const seams = [...left.seams, ...right.seams]

  const reach = around(slots)
  if (reach) {
    const middle = across ? room.x + one + SEAM_GAP / 2 : room.y + one + SEAM_GAP / 2
    seams.push(
      across
        ? {
            id: frame.id,
            along: 'row',
            from: { x: middle, y: reach.y },
            to: { x: middle, y: reach.y + reach.h },
          }
        : {
            id: frame.id,
            along: 'column',
            from: { x: reach.x, y: middle },
            to: { x: reach.x + reach.w, y: middle },
          },
    )
  }

  return { slots, seams }
}

export function lay(frame: Frame, room: Box, panes: Panes): Laid {
  return layIn(frame, room, panes, room.w * WIDEST)
}

export function seamsAmong(frame: Frame, slots: readonly Slot[]): Seam[] {
  if (frame.kind === 'pane') return []
  const [first, second] = frame.sides
  const inside = (side: Frame) => {
    const ids = new Set(panesIn(side).map((one) => one.id))
    return slots.filter((one) => ids.has(one.paneId))
  }
  const seams = [...seamsAmong(first, slots), ...seamsAmong(second, slots)]
  const a = around(inside(first))
  const b = around(inside(second))
  if (!a || !b) return seams
  const across = frame.along === 'row'
  const [lo, hi] = across ? (a.x <= b.x ? [a, b] : [b, a]) : a.y <= b.y ? [a, b] : [b, a]
  const gap = across ? hi.x - (lo.x + lo.w) : hi.y - (lo.y + lo.h)
  if (gap < SEAM_GAP / 3) return seams
  const reach = around([a, b])
  if (!reach) return seams
  const middle = across ? lo.x + lo.w + gap / 2 : lo.y + lo.h + gap / 2
  seams.push(
    across
      ? {
          id: frame.id,
          along: 'row',
          from: { x: middle, y: reach.y },
          to: { x: middle, y: reach.y + reach.h },
        }
      : {
          id: frame.id,
          along: 'column',
          from: { x: reach.x, y: middle },
          to: { x: reach.x + reach.w, y: middle },
        },
  )
  return seams
}

export function seamPath(seam: Seam): string {
  const { from, to } = seam
  const bow = Math.min(SEAM_GAP / 3, Math.hypot(to.x - from.x, to.y - from.y) / 10)
  const [dx, dy] = seam.along === 'row' ? [bow, 0] : [0, bow]
  const third = (t: number) => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  })
  const c1 = third(1 / 3)
  const c2 = third(2 / 3)
  const n = (value: number) => Math.round(value * 10) / 10
  return (
    `M${n(from.x)} ${n(from.y)} ` +
    `C${n(c1.x + dx)} ${n(c1.y + dy)} ${n(c2.x - dx)} ${n(c2.y - dy)} ${n(to.x)} ${n(to.y)}`
  )
}
