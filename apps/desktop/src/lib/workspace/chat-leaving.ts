/** A chat's pointer carried into another space, asked of the account before the file
 *  moves (`workspace.move`): a pointer moved and its chat refused is a chat with nothing
 *  pointing at it. The rule it is held to, and why, is chat-carry.ts. */

import { ApiError } from '../api'
import { onDisk } from '../on-disk'
import { nameOf, samePath, within } from '../space-paths'
import { sync } from '../sync.svelte'
import { joinPath } from '../tauri'
import { failed } from '../views/failed.svelte'
import { workspace } from '../workspace.svelte'
import { carryQuestion } from './carry-question'
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

  const [
    { listChats, moveChat },
    { chatName, readPointer },
    { keepOwnPointer, lastMoved, movedHere, ownPointer },
  ] = await Promise.all([
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
      if (await moveChat(chat, home).catch(() => false)) movedHere(chat, home)
    }
    for (const [chat, pointer] of owned) keepOwnPointer(chat, pointer)
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

  // The chats this move would carry, each once with the first of its pointers moving.
  const carrying = new Map<string, string>()
  for (const pointer of pointers) {
    const chat = await readPointer(pointer)
    if (!chat || carrying.has(chat)) continue
    // A chat goes with its pointer only where it lives in the space the pointer leaves,
    // as the account says now; a copy elsewhere, or a pointer to a chat the account does
    // not list, carries nothing, and with the account not heard the move is refused, to
    // be tried again (B542).
    const lives = spaces ? (spaces.get(chat) ?? null) : lastMoved(chat)
    if (lives === null && !spaces) await refuse(new Error('the account could not be reached'))
    if (lives !== home) continue
    // A copy beyond doubt: the chat's own pointer is known, still there, and stays behind
    // in this space. That alone is let go without a word.
    const own = ownPointer(chat)
    const staying =
      own !== null &&
      within(from.root, own) !== null &&
      !pointers.some((one) => samePath(one, own)) &&
      (await readPointer(own)) === chat
    if (!staying) carrying.set(chat, pointer)
  }
  if (!carrying.size) return none

  // Every other one is the owner's to say, then and once for the whole move: a chat's
  // history is what the people of the other space would read, and a device that only
  // inferred which pointer is the original has been wrong before.
  const names = [...carrying.values()].map((pointer) => chatName(pointer))
  const answer = await carryAsked(names, from.name, to.name)
  if (answer === null) await refuse(new Error('not moved'))
  if (answer === 'file') return none

  for (const [chat, pointer] of carrying) {
    // Not heard is not moved either: the file would be in the new space with its chat
    // still in the old one, which is what this is here to never leave behind.
    const moving = await moveChat(chat, space).catch((error: unknown) =>
      error instanceof ApiError ? error : new Error(String(error)),
    )
    if (moving instanceof Error) await refuse(moving)
    if (moving === false) await refuse(new Error('the account could not be reached'))
    moved.push(chat)
    movedHere(chat, space)
    // Its own pointer is where the move puts it, before the file operation is heard, so
    // an undo straight after finds it.
    keepOwnPointer(chat, joinPath(folder, nameOf(path)) + pointer.slice(path.length))
    owned.push([chat, pointer])
  }
  return back
}

/** The owner's answer: the chats too, the files only, or null for the question put
 *  away, and then nothing moves. */
async function carryAsked(
  names: readonly string[],
  from: string,
  to: string,
): Promise<'chat' | 'file' | null> {
  const { prompt } = await import('../prompt.svelte')
  const answer = await prompt.choose(carryQuestion(names, from, to))
  return answer === 'chat' || answer === 'file' ? answer : null
}
