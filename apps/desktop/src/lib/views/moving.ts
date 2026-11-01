/** Moves under way: from the moment a file or folder starts moving until everything
 *  kept by path has been told where it went. A link rewrite writes a moved note at its
 *  new path before the move is told (B498), and however long the rest of the rewrite
 *  takes, the runner must not take that write for a note just made (B551); it waits for
 *  the move instead. Plain state, so the workspace can say so without the runner. */

import { within } from '../space-paths'

/** Where each move under way is going; one path twice for two moves there at once. */
const flying: string[] = []
const landed = new Set<() => void>()

/** Runs a move whose file or folder ends up at `to`, said to be under way meanwhile. */
export async function moving<T>(to: string, run: () => Promise<T>): Promise<T> {
  flying.push(to)
  try {
    return await run()
  } finally {
    flying.splice(flying.indexOf(to), 1)
    for (const listener of [...landed]) listener()
  }
}

/** Whether a path is at or under where a move under way is going. */
export function landing(path: string): boolean {
  for (const to of flying) if (within(to, path) !== null) return true
  return false
}

/** Hears every move that is over. */
export function onLanded(listener: () => void): () => void {
  landed.add(listener)
  return () => landed.delete(listener)
}
