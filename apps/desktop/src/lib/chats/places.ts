/** What this device knows about a chat's own pointer and its space, for the one move
 *  that changes a chat on the account: its pointer carried into another space
 *  (workspace/chat-leaving.ts, B542).
 *
 *  A copy of a pointer is the same bytes as the original, so nothing on the disk tells
 *  the two apart. The device keeps which one is the chat's own, per account and across
 *  launches: the pointer it made, or found alone in the chat's space, or that pointer
 *  where it was moved to. Two pointers in the chat's space and neither kept is not
 *  decided by their order in the tree, where `Plans copy.chat` sorts before
 *  `Plans.chat`: the own pointer is unknown then, and a move of either asks.
 *
 *  The space a chat lives in is the account's listing; a move this device has just made
 *  is kept too, in memory, for when the listing cannot be heard yet: an undo straight
 *  after a move would otherwise go by where the chat was. */

import { account } from '../account.svelte'
import { keep, stored } from '../stored'

const KEY = 'nib:chat-own-pointers'

/** Whom the chats were last started for: the store says, and a move asked before it
 *  has started goes by whoever is signed in. */
let current: string | null = null

export function startedFor(id: string): void {
  current = id
}

function who(): string | null {
  return current ?? account.user?.id ?? account.guest?.id ?? null
}

/** Chat id to the path of its own pointer, for each account, read once and written
 *  through. Held in memory as well, so a storage that refuses keeps it for the run. */
const own = new Map<string, Map<string, string>>()

function owned(id: string): Map<string, string> {
  const held = own.get(id)
  if (held) return held
  const map = new Map<string, string>()
  const kept = stored(`${KEY}:${id}`)
  if (kept && typeof kept === 'object' && !Array.isArray(kept)) {
    for (const [chat, path] of Object.entries(kept)) {
      if (typeof path === 'string') map.set(chat, path)
    }
  }
  own.set(id, map)
  return map
}

/** The pointer that is the chat's own on this device, or null where that is not known. */
export function ownPointer(chat: string): string | null {
  const id = who()
  return id ? (owned(id).get(chat) ?? null) : null
}

/** Every chat's own pointer this device keeps, for the account signed in. */
export function ownPointers(): [string, string][] {
  const id = who()
  return id ? [...owned(id)] : []
}

/** The chat's own pointer is this one now, or, given null, is not known any more. */
export function keepOwnPointer(chat: string, path: string | null): void {
  const id = who()
  if (!id) return
  const map = owned(id)
  if ((map.get(chat) ?? null) === path) return
  if (path === null) map.delete(chat)
  else map.set(chat, path)
  keep(`${KEY}:${id}`, JSON.stringify(Object.fromEntries(map)))
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
