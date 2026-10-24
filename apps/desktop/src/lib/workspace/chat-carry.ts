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
 *  moves: refused, nothing moves. This is the rule; the asking is chat-leaving.ts, fetched
 *  with the first such move, and the plugin, which has no chats, has a twin of that. */

import { isChatTarget } from '@nib/markdown/links'
import { account } from '../account.svelte'
import { roleOf } from '../sharing.svelte'
import { samePath, within } from '../space-paths'
import { sync } from '../sync.svelte'
import { type Entry, workspace } from '../workspace.svelte'

/** The pointers a move of this path carries: the file itself, or every one in the
 *  folder. */
export function pointersIn(path: string): string[] {
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

export function spaceHolding(path: string) {
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
