/** What this device knows about a chat's own pointer and its space, for the one move
 *  that changes a chat on the account: its pointer carried into another space
 *  (workspace/chat-leaving.ts, B542).
 *
 *  A copy of a pointer is the same bytes as the original, so nothing on the disk tells
 *  the two apart. The pointer the chats store lists a chat at is the chat's own, and it
 *  is kept here across launches: after a relaunch a duplicate beside its original sorts
 *  first in the tree, and taken for the original it would carry the chat away. What the
 *  device does not know it never guesses: no pointer kept means no carry.
 *
 *  The space a chat lives in is the account's listing; a move this device has just made
 *  is kept too, in memory, for when the listing cannot be heard yet: an undo straight
 *  after a move would otherwise go by where the chat was. */

import { keep, stored } from '../stored'

const KEY = 'nib:chat-own-pointers'

/** Chat id to the path of its own pointer, read once and written through. Held in
 *  memory as well, so a storage that refuses keeps it for the run. */
let own: Map<string, string> | null = null

function owned(): Map<string, string> {
  if (own) return own
  own = new Map()
  const kept = stored(KEY)
  if (kept && typeof kept === 'object' && !Array.isArray(kept)) {
    for (const [chat, path] of Object.entries(kept)) {
      if (typeof path === 'string') own.set(chat, path)
    }
  }
  return own
}

function write(): void {
  keep(KEY, JSON.stringify(Object.fromEntries(owned())))
}

/** The pointer that is the chat's own on this device, or null where it never placed it. */
export function ownPointer(chat: string): string | null {
  return owned().get(chat) ?? null
}

/** The chats store's places, as it has them now. `all` for a scan of every space, which
 *  lets go of a chat it found no pointer for. */
export function keepOwnPointers(places: Iterable<[string, string]>, all = false): void {
  const map = owned()
  const next = new Map(places)
  if (all) for (const chat of [...map.keys()]) if (!next.has(chat)) map.delete(chat)
  let changed = all
  for (const [chat, path] of next) {
    if (map.get(chat) === path) continue
    map.set(chat, path)
    changed = true
  }
  if (changed) write()
}

/** Where this device last moved a chat on the account, this run. */
const moves = new Map<string, string>()

export function movedHere(chat: string, space: string): void {
  moves.set(chat, space)
}

export function lastMoved(chat: string): string | null {
  return moves.get(chat) ?? null
}

/** The session ended: its moves are no guide to the next one's. */
export function forgetMoves(): void {
  moves.clear()
}
