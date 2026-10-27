/** A chat's pointer carried into another space, asked of the account before the file
 *  moves (`workspace.move`): a pointer moved and its chat refused is a chat with nothing
 *  pointing at it. The rule it is held to, and why, is chat-carry.ts. */

import { ApiError } from '../api'
import { onDisk } from '../on-disk'
import { nameOf, samePath } from '../space-paths'
import { sync } from '../sync.svelte'
import { joinPath } from '../tauri'
import { failed } from '../views/failed.svelte'
import { workspace } from '../workspace.svelte'
import { mayCarry, pointersMoving, spaceHolding } from './chat-carry'

/** Before `path` moves into `folder`: the chats it carries into another space, moved
 *  there on the account first. Throws where the file may not move, with the toast saying
 *  "Not moved" and the way to try again, so a menu's move stays put and an agent's move
 *  is answered with why; a chat already moved for a folder whose next one was refused is
 *  asked back, so nothing is half moved. Answers the way back, for the file's own move
 *  failing after the chats went (B217). */
export async function chatsCarried(path: string, folder: string): Promise<() => Promise<void>> {
  const none = () => Promise.resolve()
  const from = spaceHolding(path)
  const to = spaceHolding(folder)
  if (!from || !to || samePath(from.root, to.root)) return none
  const pointers = await pointersMoving(path)
  if (!pointers.length) return none

  const [{ listChats, moveChat }, { readPointer }, places] = await Promise.all([
    import('../chats/http'),
    import('../chats/pointers'),
    import('../chats/places'),
  ])
  const moved: string[] = []
  const owned: [string, string][] = []
  const home = sync.remoteIdFor(from.root)
  const back = async () => {
    if (!home) return
    for (const chat of moved) {
      if (await moveChat(chat, home).catch(() => false)) places.movedHere(chat, home)
    }
    places.keepOwnPointers(owned)
  }
  const refuse = async (error: Error): Promise<never> => {
    await back()
    failed.tell(() => void workspace.move(path, folder).catch(() => undefined))
    throw error
  }
  // A name already taken there is a move the disk refuses, found before the account is
  // asked anything: two spaces each with a General.chat is the usual way to meet it.
  if (await onDisk(joinPath(folder, nameOf(path)))) {
    await refuse(new Error('something already lives there'))
  }
  if (!mayCarry(path, to.root, pointers)) await refuse(new Error('only the owner can do that'))
  const space = sync.remoteIdFor(to.root)
  // A folder on no account has no chat to move there, and the pointer is a file like
  // any other in it.
  if (!space || space === home) return none

  // Where each chat lives now, asked of the account rather than taken from a listing
  // that may be from before a move this device has just made (an undo straight after).
  const listing = await listChats().catch(() => null)
  const spaces = listing ? new Map(listing.chats.map((one) => [one.id, one.space])) : null

  for (const pointer of pointers) {
    const chat = await readPointer(pointer)
    if (!chat) continue
    // Only the chat's own pointer carries it: one in the space the chat lives in on the
    // account, and the one this device lists it at. A copy - in another space, or beside
    // it - carries nothing, and neither does a pointer to a chat the account does not
    // list: the file moves and the chat stays where it lives (B542). Where the device
    // cannot tell, it does not guess: the move is refused, to be tried again.
    const lives = spaces ? (spaces.get(chat) ?? null) : places.lastMoved(chat)
    if (lives === null && !spaces) await refuse(new Error('the account could not be reached'))
    if (lives !== home) continue
    const own = places.ownPointer(chat)
    if (own === null) await refuse(new Error('the chat is not listed on this device yet'))
    if (!pointers.some((one) => samePath(one, own))) continue
    // Not heard is not moved either: the file would be in the new space with its chat
    // still in the old one, which is what this is here to never leave behind.
    const answer = await moveChat(chat, space).catch((error: unknown) =>
      error instanceof ApiError ? error : new Error(String(error)),
    )
    if (answer instanceof Error) await refuse(answer)
    if (answer === false) await refuse(new Error('the account could not be reached'))
    moved.push(chat)
    places.movedHere(chat, space)
    // Its own pointer is where the move puts it, before the file operation is heard, so
    // an undo straight after carries it back.
    places.keepOwnPointers([[chat, joinPath(folder, nameOf(path)) + pointer.slice(path.length)]])
    owned.push([chat, pointer])
  }
  return back
}
