/** Spaces whose folders moved before the page ran: a phone's container named afresh
 *  (moved.ts), and the spaces of a folder outside Orden's own taken in (#552, outside.ts).
 *  What the page stored is said again under the new roots before anything reads it; the
 *  sync engine's store is its own, so the moves are written down here for it, and it
 *  says its spaces again under them as it starts (`followRoots`), keeping their ids. */

import { movedTo } from '../space-paths'
import type { Core } from '../sync2/core'
import type { Change } from '../sync2/store'
import { forget, isRecord, isString, keepJson, stored } from '../stored'

export const ROOTS_MOVED = 'nib:roots-moved'

export interface RootMoved {
  from: string
  to: string
}

const isMove = (one: unknown): one is RootMoved =>
  isRecord(one) && isString(one.from) && isString(one.to)

export function rootsMoved(): RootMoved[] {
  const said = stored(ROOTS_MOVED)
  return Array.isArray(said) ? said.filter(isMove) : []
}

/** `moves` written down beside the ones still waiting, each root once. */
export function noteRootsMoved(moves: readonly RootMoved[]): void {
  if (!moves.length) return
  const kept = rootsMoved().filter((one) => !moves.some((move) => move.from === one.from))
  keepJson(ROOTS_MOVED, [...kept, ...moves])
}

/** Where `root` is now, if it or a folder it is in moved. */
export function movedRoot(root: string, moves: readonly RootMoved[]): string | null {
  for (const { from, to } of moves) {
    const now = movedTo(root, from, to)
    if (now !== null) return now
  }
  return null
}

/** The engine's spaces said again under the roots they moved to, and the moves let go. */
export async function followRoots(core: Pick<Core, 'spaces' | 'rootMoved' | 'commit'>) {
  const moves = rootsMoved()
  if (!moves.length) return
  const changes: Change[] = []
  for (const space of core.spaces.values()) {
    const to = movedRoot(space.row.root, moves)
    if (to !== null) changes.push(...core.rootMoved(space.id, to))
  }
  if (changes.length) await core.commit(changes)
  forget(ROOTS_MOVED)
}
