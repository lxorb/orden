/** A chat's pointer carried into another space: Move to space, a drag onto another space,
 *  the file list's Move, an agent's move, a folder holding pointers moved along with it.
 *
 *  A move between spaces is the one move that changes a chat on the account: its pointer
 *  in the new space means the chat lives there (`PATCH /v2/chats/:id {space}`, docs/
 *  chats.md 4.2). The account refuses it to somebody who does not write in the space it
 *  leaves, and to a writer who is not that space's owner for a space of somebody else,
 *  since a move leaves nothing in the owner's Recently deleted. A file moved first and
 *  refused after is the worst of both: the pointer in the owner's trash, the chat where it
 *  was with nothing pointing at it, and emptying the trash ends it (B193). So the same
 *  rule decides which spaces are offered, and the account is asked before the file
 *  moves: refused, nothing moves. The chats' own modules are fetched with the first such
 *  move, and the plugin, which has no chats, has a twin of this (`chat-carry.even.ts`). */

import { isChatTarget } from '@nib/markdown/links'
import { account } from '../account.svelte'
import { ApiError } from '../api'
import { roleOf } from '../sharing.svelte'
import { samePath, within } from '../space-paths'
import { sync } from '../sync.svelte'
import { failed } from '../views/failed.svelte'
import { type Entry, workspace } from '../workspace.svelte'

/** The pointers a move of this path carries: the file itself, or every one in the
 *  folder. */
function pointersIn(path: string): string[] {
  const found: string[] = []
  const walk = (entry: Entry) => {
    if (!entry.is_dir) {
      if (isChatTarget(entry.path)) found.push(entry.path)
      return
    }
    for (const child of entry.children) walk(child)
  }
  const entry = workspace.entryAt(path)
  if (entry) walk(entry)
  else if (isChatTarget(path)) found.push(path)
  return found
}

function spaceHolding(path: string) {
  return workspace.spaces.find((one) => within(one.root, path) !== null) ?? null
}

/** Who owns the space at this root, by account id: this account for its own and for a
 *  folder that is on no account, else the first of the faces the listing names, which
 *  is the owner's (`facesIn` in services/sync). Null where nobody is known. */
function ownerOf(root: string): string | null {
  const id = sync.remoteIdFor(root)
  const remote = id ? account.spaces.find((one) => one.id === id) : undefined
  if (!remote || remote.role === 'owner') return account.user?.id ?? null
  return remote.people?.[0] ?? null
}

/** Whether what is at `path` may be moved into the space at `root` as far as the chats
 *  it carries go. Anything that carries no pointer may, and so may anything moved by the
 *  owner of the space it leaves; a writer moves a chat only into another space of the
 *  same owner, and where the owners are not known it is not offered. */
export function mayCarry(path: string, root: string): boolean {
  const from = spaceHolding(path)
  if (!from || samePath(from.root, root) || !pointersIn(path).length) return true
  if (roleOf(from.root) === 'owner') return true
  const owner = ownerOf(from.root)
  return owner !== null && owner === ownerOf(root)
}

/** Before `path` moves into `folder`: the chats it carries into another space, moved
 *  there on the account first. Throws where the file may not move, with the toast saying
 *  "Not moved" and the way to try again, so a menu's move stays put and an agent's move
 *  is answered with why; a chat already moved for a folder whose next one was refused is
 *  asked back, so nothing is half moved. */
export async function chatsCarried(path: string, folder: string): Promise<void> {
  const from = spaceHolding(path)
  const to = spaceHolding(folder)
  if (!from || !to || samePath(from.root, to.root)) return
  const pointers = pointersIn(path)
  if (!pointers.length) return

  const [{ moveChat }, { readPointer }] = await Promise.all([
    import('../chats/http'),
    import('../chats/pointers'),
  ])
  const moved: string[] = []
  const home = sync.remoteIdFor(from.root)
  const refuse = async (error: Error): Promise<never> => {
    if (home) for (const chat of moved) await moveChat(chat, home).catch(() => false)
    failed.tell(() => void workspace.move(path, folder).catch(() => undefined))
    throw error
  }
  if (!mayCarry(path, to.root)) await refuse(new Error('only the owner can do that'))
  const space = sync.remoteIdFor(to.root)
  // A folder on no account has no chat to move there, and the pointer is a file like
  // any other in it.
  if (!space || space === home) return

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
}
