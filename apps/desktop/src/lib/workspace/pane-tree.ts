/** The shape of the panes: what sits beside what, and how much room each takes.
 *
 *  Two panes side by side are a split with two sides, and a side is either a
 *  pane or another split. A pane may split once in each direction and no
 *  further, which is a 2x2 at most: a fifth pane would make every note a column
 *  of text too narrow to read, and a window with five things in it is a window
 *  nobody can find anything in.
 *
 *  Everything here is a pure function of a frame, so the tests read trees rather
 *  than the running app; the state and the focus live next door in
 *  panes.svelte.ts. */

/** Side by side, or one above the other. */
export type Along = 'row' | 'column'

export interface Pane {
  kind: 'pane'
  id: string
  /** Which of this pane's tabs is showing. A tab knows which pane it is in;
   *  see documents.svelte.ts. */
  activeTabId: string | null
  /** Whether this pane scrolls with the other one showing the same note. */
  linked: boolean
}

export interface Split {
  kind: 'split'
  id: string
  along: Along
  /** What share of the room the first side takes, between 0 and 1. */
  fraction: number
  sides: [Frame, Frame]
}

export type Frame = Pane | Split

/** Both sides the same, which is what a split opens at and what a double click
 *  on the divider puts back. */
export const EQUAL = 0.5

/** The least room a pane may be dragged down to, in pixels. Below this there is
 *  no writing area left, only a margin. */
const LEAST = 220

export function pane(id: string, activeTabId: string | null = null): Pane {
  return { kind: 'pane', id, activeTabId, linked: false }
}

/** Every pane, in the order they are laid out: left to right, top to bottom. */
export function panesIn(frame: Frame): Pane[] {
  return frame.kind === 'pane' ? [frame] : [...panesIn(frame.sides[0]), ...panesIn(frame.sides[1])]
}

export function paneIn(frame: Frame, id: string): Pane | null {
  return panesIn(frame).find((one) => one.id === id) ?? null
}

/** The splits above a pane, outermost first. Null when the pane is not in the
 *  frame at all, which is what tells "at the root" from "not there". */
function above(frame: Frame, id: string, trail: Split[] = []): Split[] | null {
  if (frame.kind === 'pane') return frame.id === id ? trail : null

  for (const side of frame.sides) {
    const found = above(side, id, [...trail, frame])
    if (found) return found
  }

  return null
}

/** Whether a pane may still be split that way.
 *
 *  A pane at the root may split either way. A pane that is already one side of
 *  a split may split across it and not along it: along it would be three panes
 *  in a row, and across it is the second half of the 2x2. Deeper than that,
 *  nothing. */
export function canSplit(frame: Frame, id: string, along: Along): boolean {
  const trail = above(frame, id)
  if (!trail) return false
  if (trail.length === 0) return true

  const outer = trail[0]
  return trail.length === 1 && outer !== undefined && outer.along !== along
}

/** The pane put beside or below itself, with `made` taking the new side. */
export function withSplit(
  frame: Frame,
  id: string,
  along: Along,
  made: Pane,
  split: string,
): Frame {
  if (frame.kind === 'pane') {
    if (frame.id !== id) return frame
    return { kind: 'split', id: split, along, fraction: EQUAL, sides: [frame, made] }
  }

  const [first, second] = frame.sides
  return {
    ...frame,
    sides: [withSplit(first, id, along, made, split), withSplit(second, id, along, made, split)],
  }
}

/** The frame without a pane: its sibling takes the room. The last pane cannot
 *  go, since a window with no pane has nowhere to show a note. */
export function withoutPane(frame: Frame, id: string): Frame {
  if (frame.kind === 'pane') return frame

  const [first, second] = frame.sides
  if (first.kind === 'pane' && first.id === id) return second
  if (second.kind === 'pane' && second.id === id) return first

  return { ...frame, sides: [withoutPane(first, id), withoutPane(second, id)] }
}

export function withFraction(frame: Frame, id: string, fraction: number): Frame {
  if (frame.kind === 'pane') return frame

  const [first, second] = frame.sides
  const sides: [Frame, Frame] = [
    withFraction(first, id, fraction),
    withFraction(second, id, fraction),
  ]

  return frame.id === id ? { ...frame, fraction, sides } : { ...frame, sides }
}

/** The next pane round, so one key moves the focus through all of them. */
export function nextPane(frame: Frame, id: string): Pane | null {
  const panes = panesIn(frame)
  const at = panes.findIndex((one) => one.id === id)
  if (at < 0) return panes[0] ?? null

  return panes[(at + 1) % panes.length] ?? null
}

/** A fraction that leaves both sides something to show. A window too small for
 *  two of them at all is split down the middle, which is the honest answer. */
export function clamped(fraction: number, room: number, least = LEAST): number {
  if (room <= least * 2) return EQUAL

  const edge = least / room
  return Math.min(1 - edge, Math.max(edge, fraction))
}
