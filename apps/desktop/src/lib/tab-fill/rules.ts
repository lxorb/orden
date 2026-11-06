export interface Filling {
  fills: string | null
  focusedId: string
  showing: string | null
}

export function mayFill(showing: string | null, touch: boolean): boolean {
  return showing !== null && !touch
}

export function stillFills(panes: Filling): boolean {
  return panes.fills !== null && panes.fills === panes.focusedId && panes.showing !== null
}

export interface Holder {
  closest(selector: string): unknown
  readonly isContentEditable?: boolean
  readonly tagName?: string
}

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function escapeLeaves(holder: Holder | null): boolean {
  if (holder === null) return true
  if (holder.isContentEditable === true || FIELDS.has(holder.tagName ?? '')) return false

  return holder.closest('[data-pane]') === null
}

export function mayHide(held: { pointer: boolean; keyboard: boolean; layers: number }): boolean {
  return !held.pointer && !held.keyboard && held.layers === 0
}

export const EDGE = 6

export function atEdge(y: number): boolean {
  return y >= 0 && y < EDGE
}
