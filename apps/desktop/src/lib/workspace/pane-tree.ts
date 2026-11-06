export type Along = 'row' | 'column'

export interface Pane {
  kind: 'pane'
  id: string
  activeTabId: string | null
  linked: boolean
  stacked: boolean
}

export interface Split {
  kind: 'split'
  id: string
  along: Along
  fraction: number
  sides: [Frame, Frame]
}

export type Frame = Pane | Split

export const EQUAL = 0.5

const LEAST = 220

export function pane(id: string, activeTabId: string | null = null): Pane {
  return { kind: 'pane', id, activeTabId, linked: false, stacked: false }
}

export function panesIn(frame: Frame): Pane[] {
  return frame.kind === 'pane' ? [frame] : [...panesIn(frame.sides[0]), ...panesIn(frame.sides[1])]
}

export function paneIn(frame: Frame, id: string): Pane | null {
  return panesIn(frame).find((one) => one.id === id) ?? null
}

function above(frame: Frame, id: string, trail: Split[] = []): Split[] | null {
  if (frame.kind === 'pane') return frame.id === id ? trail : null

  for (const side of frame.sides) {
    const found = above(side, id, [...trail, frame])
    if (found) return found
  }

  return null
}

export function canSplit(frame: Frame, id: string, along: Along): boolean {
  const trail = above(frame, id)
  if (!trail) return false
  if (trail.length === 0) return true

  const outer = trail[0]
  return trail.length === 1 && outer !== undefined && outer.along !== along
}

export function withSplit(
  frame: Frame,
  id: string,
  along: Along,
  made: Pane,
  split: string,
  near = false,
): Frame {
  if (frame.kind === 'pane') {
    if (frame.id !== id) return frame

    const sides: [Frame, Frame] = near ? [made, frame] : [frame, made]
    return { kind: 'split', id: split, along, fraction: EQUAL, sides }
  }

  const [first, second] = frame.sides
  return {
    ...frame,
    sides: [
      withSplit(first, id, along, made, split, near),
      withSplit(second, id, along, made, split, near),
    ],
  }
}

export function withoutPane(frame: Frame, id: string): Frame {
  if (frame.kind === 'pane') return frame

  const [first, second] = frame.sides
  if (first.kind === 'pane' && first.id === id) return second
  if (second.kind === 'pane' && second.id === id) return first

  return { ...frame, sides: [withoutPane(first, id), withoutPane(second, id)] }
}

export function splitIn(frame: Frame, id: string): Split | null {
  if (frame.kind === 'pane') return null
  if (frame.id === id) return frame

  return splitIn(frame.sides[0], id) ?? splitIn(frame.sides[1], id)
}

export function nextPane(frame: Frame, id: string): Pane | null {
  const panes = panesIn(frame)
  const at = panes.findIndex((one) => one.id === id)
  if (at < 0) return panes[0] ?? null

  return panes[(at + 1) % panes.length] ?? null
}

export function clamped(fraction: number, room: number, least = LEAST): number {
  if (room <= least * 2) return EQUAL

  const edge = least / room
  return Math.min(1 - edge, Math.max(edge, fraction))
}

export type Toward = 'left' | 'right' | 'up' | 'down'

interface Place {
  pane: Pane
  x: number
  y: number
  width: number
  height: number
}

function placesIn(frame: Frame, x = 0, y = 0, width = 1, height = 1): Place[] {
  if (frame.kind === 'pane') return [{ pane: frame, x, y, width, height }]

  const [first, second] = frame.sides
  if (frame.along === 'row') {
    const split = width * frame.fraction
    return [
      ...placesIn(first, x, y, split, height),
      ...placesIn(second, x + split, y, width - split, height),
    ]
  }
  const split = height * frame.fraction
  return [
    ...placesIn(first, x, y, width, split),
    ...placesIn(second, x, y + split, width, height - split),
  ]
}

function overlap(from: number, length: number, otherFrom: number, otherLength: number): number {
  return Math.min(from + length, otherFrom + otherLength) - Math.max(from, otherFrom)
}

export function paneToward(frame: Frame, id: string, toward: Toward): Pane | null {
  const places = placesIn(frame)
  const here = places.find((one) => one.pane.id === id)
  if (!here) return null

  const EDGE = 1e-6
  const across = toward === 'left' || toward === 'right'
  const middle = across ? here.y + here.height / 2 : here.x + here.width / 2

  let best: { place: Place; off: number } | null = null
  for (const one of places) {
    if (one === here) continue
    const beside = {
      left: Math.abs(one.x + one.width - here.x) < EDGE,
      right: Math.abs(here.x + here.width - one.x) < EDGE,
      up: Math.abs(one.y + one.height - here.y) < EDGE,
      down: Math.abs(here.y + here.height - one.y) < EDGE,
    }[toward]
    const shared = across
      ? overlap(one.y, one.height, here.y, here.height)
      : overlap(one.x, one.width, here.x, here.width)
    if (!beside || shared <= EDGE) continue

    const centre = across ? one.y + one.height / 2 : one.x + one.width / 2
    const off = Math.abs(centre - middle)
    if (!best || off < best.off) best = { place: one, off }
  }

  return best?.place.pane ?? null
}

export function topRow(frame: Frame): Frame {
  if (frame.kind === 'pane') return frame
  if (frame.along === 'column') return topRow(frame.sides[0])
  return { ...frame, sides: [topRow(frame.sides[0]), topRow(frame.sides[1])] }
}

export function bottomRow(frame: Frame): Frame {
  if (frame.kind === 'pane') return frame
  if (frame.along === 'column') return bottomRow(frame.sides[1])
  return { ...frame, sides: [bottomRow(frame.sides[0]), bottomRow(frame.sides[1])] }
}

export function tracks(split: Split): string {
  return `minmax(0, ${split.fraction.toFixed(5)}fr) var(--card-gap) minmax(0, ${(1 - split.fraction).toFixed(5)}fr)`
}
