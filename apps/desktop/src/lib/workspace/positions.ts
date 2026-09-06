/** Where each note was last being read on this device, kept after the tab that
 *  was reading it has closed - so opening it again lands where it was left
 *  rather than at the top.
 *
 *  Keyed by path, and it outlives every tab in it, so it has to stop growing
 *  somewhere: three hundred notes is more than anyone comes back to and small
 *  enough to write down on every pause in the typing. */

import { without } from '../records'
import type { Position } from './session'

/** Enough for every note anyone comes back to, small enough for storage. */
const KEPT = 300

export class Positions {
  private places: Record<string, Position>

  constructor(places: Record<string, Position> = {}) {
    this.places = places
  }

  /** What goes into the session. */
  get all(): Record<string, Position> {
    return this.places
  }

  /** Where a note was last looked at. Nothing at all for one nobody has
   *  opened, which reads as the top of the note. */
  of(path: string): Partial<Pick<Position, 'cursor' | 'scroll' | 'anchor'>> {
    const known = this.places[path]
    return known ? { cursor: known.cursor, scroll: known.scroll, anchor: known.anchor } : {}
  }

  remember(path: string, cursor: number, scroll: number, anchor?: number) {
    const place: Position = { cursor, scroll, anchor, at: Date.now() }
    const entries = Object.entries({ ...this.places, [path]: place })

    // Most recently looked at first, and everything past what is worth keeping
    // dropped.
    if (entries.length > KEPT) {
      entries.sort(([, a], [, b]) => b.at - a.at)
      entries.length = KEPT
    }

    this.places = Object.fromEntries(entries)
  }

  /** A note that moves takes its place along. */
  move(from: string, to: string) {
    const known = this.places[from]
    if (!known) return

    this.places = { ...without(this.places, from), [to]: known }
  }
}
