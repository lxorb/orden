/** Where each window of the overview lies, and where the lines between a split's sides
 *  run (issue #331).
 *
 *  The canvas is the panes drawn small: a split side by side is two groups of windows side
 *  by side, one above the other is two groups stacked, and each pane's tabs are a grid of
 *  windows the shape of that pane. So what is beside what in the window is beside what
 *  here, before a word is read, and a seam - a curve in the gap between a split's two
 *  sides - says where one side ends and the other begins.
 *
 *  Pure: the frame, each pane's tabs and shape, and the room, in; boxes out. */

import { type Frame, panesIn } from '../workspace/pane-tree'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** A window's place, and the pane it belongs to. */
export interface Slot extends Box {
  id: string
  paneId: string
}

/** The line between a split's two sides: from one end of the gap to the other, down
 *  its middle. `along` is the split's own: `row` is a vertical line between two sides
 *  side by side. */
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

/** What `lay` needs to know of the panes. */
export interface Panes {
  /** A pane's tabs, in its strip's order. */
  tabsOf: (paneId: string) => readonly string[]
  /** Width over height of what a pane shows, which each of its windows takes. */
  shapeOf: (paneId: string) => number
  /** How much room a window's name takes under it on the canvas, where that is more than
   *  the gap between two rows: the camera drawn back, the names their size on the
   *  screen. */
  named?: number
}

/** The room between two windows, and between a split's sides, which the seam runs in. */
const GAP = 28
/** And between two rows, which holds the name under each window of the upper. */
const ROW_GAP = 60
const SEAM_GAP = 56

/** No window wider than this share of the room, so one tab alone is a window on a
 *  canvas and not the pane again. */
const WIDEST = 0.46

/** A side's share of a split, by how many windows it holds: a pane of eight tabs next to
 *  a pane of one is given more of the room, never all of it. */
function shareOf(first: number, second: number): number {
  const a = Math.sqrt(Math.max(first, 1))
  const b = Math.sqrt(Math.max(second, 1))
  return Math.min(0.7, Math.max(0.3, a / (a + b)))
}

function countIn(frame: Frame, panes: Panes): number {
  if (frame.kind === 'pane') return panes.tabsOf(frame.id).length
  return countIn(frame.sides[0], panes) + countIn(frame.sides[1], panes)
}

/** The grid that gives `count` windows of `shape` the most room in `room`: how many
 *  across, and how wide each is. */
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

/** One pane's windows, centred in its room, the last row centred under the others. */
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

/** The box round some slots. */
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

  // Down the middle of the gap, as long as the windows on either side reach.
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

/** Every window and seam of `frame` in `room`. */
export function lay(frame: Frame, room: Box, panes: Panes): Laid {
  return layIn(frame, room, panes, room.w * WIDEST)
}

/** The seams between a split's sides where its windows lie anywhere (free.ts): down the
 *  middle of the gap between the two sides' windows, where there is one to run in. Two
 *  sides whose windows were moved in among each other's have no line between them,
 *  rather than one drawn across a window. */
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

/** A seam as a path: a gentle S from one end to the other, bowing a little to either
 *  side of the gap's middle, so it reads as drawn by a hand rather than ruled. */
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
