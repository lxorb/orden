import type { FoldLines } from '@orden/editor'
import { movedTo, samePath } from '../platform/src/api'
import type { FileOp } from './file-ops'
import type { Position } from './session'

const KEPT = 300

export class Positions {
  private places: Record<string, Position>

  constructor(places: Record<string, Position> = {}) {
    this.places = places
  }

  get all(): Record<string, Position> {
    return this.places
  }

  of(path: string): Partial<Pick<Position, 'cursor' | 'scroll' | 'anchor' | 'folds'>> {
    const known = this.places[path] ?? this.spelledOtherwise(path)
    return known
      ? { cursor: known.cursor, scroll: known.scroll, anchor: known.anchor, folds: known.folds }
      : {}
  }

  private spelledOtherwise(path: string): Position | undefined {
    for (const [one, place] of Object.entries(this.places)) if (samePath(one, path)) return place
    return undefined
  }

  remember(
    path: string,
    cursor: number,
    scroll: number,
    anchor?: number,
    folds?: readonly FoldLines[],
  ) {
    const place: Position = {
      cursor,
      scroll,
      anchor,
      ...(folds?.length ? { folds } : {}),
      at: Date.now(),
    }
    const entries = Object.entries({ ...this.places, [path]: place })

    if (entries.length > KEPT) {
      entries.sort(([, a], [, b]) => b.at - a.at)
      entries.length = KEPT
    }

    this.places = Object.fromEntries(entries)
  }

  follow(op: FileOp) {
    if (op.op !== 'moved') return

    const was = Object.entries(this.places)
    const now = was.map(([path, place]): [string, Position] => [
      movedTo(path, op.from, op.to) ?? path,
      place,
    ])

    if (now.some(([path], at) => path !== was[at]?.[0])) this.places = Object.fromEntries(now)
  }
}
