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
import { mayCarry, pointersIn, spaceHolding } from './chat-carry'

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
  const pointers = pointersIn(path)
  if (!pointers.length) return none

  const [{ moveChat }, { readPointer }] = await Promise.all([
    import('../chats/http'),
    import('../chats/pointers'),
  ])
  const moved: string[] = []
  const home = sync.remoteIdFor(from.root)
  const back = async () => {
    if (home) for (const chat of moved) await moveChat(chat, home).catch(() => false)
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
  if (!mayCarry(path, to.root)) await refuse(new Error('only the owner can do that'))
  const space = sync.remoteIdFor(to.root)
  // A folder on no account has no chat to move there, and the pointer is a file like
  // any other in it.
  if (!space || space === home) return none

  for (const pointer of pointers) {
    const chat = await readPointer(pointer)
    if (!chat) continue
    // Not heard is not moved either: the file would be in the new space with its chat
    // still in the old one, which is what this is here to never leave behind.
    const answer = await moveChat(chat, space).catch((error: unknown) =>
      error instanceof ApiError ? error : new Error(String(error)),
    )
    if (answer instanceof Error) await refuse(answer)
    if (answer === false) await refuse(new Error('the account could not be reached'))
    moved.push(chat)
  }
  return back
}
