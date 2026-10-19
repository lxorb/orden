/** The spaces made, adopted, renamed and deleted: the changes to the list that happen a
 *  few times in the life of a window, fetched by the first of them rather than carried
 *  in front of the first paint. Reading the list, its order and which space is open are
 *  spaces.ts. */

import { account } from '../account.svelte'
import { identifier } from '../identifier'
import { samePath } from '../space-paths'
import { invoke } from '../tauri'
import type { Space } from '../workspace.svelte'
import { type HoldsSpaces, selectSpace } from './spaces'

/** Creates a space folder under the one the app owns. The name is the only
 *  thing asked for; where it lives is not a decision worth making. */
/** A space the account has that this machine does not. Makes the folder and
 *  lists it, but does not switch to it: adopting someone else's space in the
 *  background should not move what is on screen out from under the writer.
 *  Unless nothing is on screen - a machine that has just erased its notes,
 *  or never had any, would otherwise list the account's spaces and show
 *  none of them. */
export async function adoptSpace(
  ws: HoldsSpaces,
  name: string,
  fresh = false,
): Promise<string | null> {
  // `fresh` is a space that must have a folder of its own even though one of
  // that name is already here: two spaces can be called the same thing once
  // one of them is somebody else's. The folder is then numbered, which is
  // what create_space does with a name that is taken.
  const existing = fresh ? undefined : ws.spaces.find((space) => space.name === name)
  if (existing) return existing.root

  const created = await invoke<{ name: string; path: string }>('create_space', {
    name: name.trim(),
  }).catch(() => null)

  if (!created) return null

  if (!ws.spaces.some((space) => samePath(space.root, created.path))) {
    const space: Space = { id: identifier(), name: created.name, root: created.path }
    ws.spaces = [...ws.spaces, space]

    if (ws.activeSpaceId) ws.persist()
    else await selectSpace(ws, space.id)
  }

  return created.path
}

export async function addSpace(ws: HoldsSpaces, name: string) {
  if (!name.trim()) return

  const created = await invoke<{ name: string; path: string }>('create_space', {
    name: name.trim(),
  }).catch(() => null)

  if (!created) return

  const space: Space = { id: identifier(), name: created.name, root: created.path }
  ws.spaces = [...ws.spaces, space]
  await selectSpace(ws, space.id)
  return space
}

export async function renameSpace(ws: HoldsSpaces, id: string, name: string) {
  const space = ws.spaces.find((entry) => entry.id === id)
  if (!space || !name.trim()) return

  // The field in the header is done with, whatever the folder answers: it is
  // held under the root, and the root is what is about to change.
  ws.naming = null

  const renamed = await invoke<{ name: string; path: string }>('rename_space', {
    from: space.root,
    name: name.trim(),
  }).catch(() => null)

  if (!renamed) return

  // A space moving is a file operation like any other, said once: the open notes
  // move with their folder, and everything kept under the root follows it - the
  // icon, the order its list is read in, the folder icons and the rest, and the
  // account's table of what it holds, in the same breath as the notes' paths, so a
  // note is never for a moment at a path the account has no id for. See
  // workspace/file-ops.ts, and the space-rename drive for what that moment cost.
  const from = space.root
  space.name = renamed.name
  space.root = renamed.path
  await ws.fileMoved(from, renamed.path, 'space')

  if (ws.activeSpaceId === id) await ws.loadTree()
  ws.persist()
}

/** Deletes the space's folder. The app owns that folder, so dropping it from
 *  the list alone would only bring it back on the next launch. */
/** `keep` puts the folder in this device's trash instead of deleting it, for
 *  a space whose folder may hold more than any Recently deleted does - which
 *  is every space sync takes away; see `reconcile` in sync.svelte.ts. */
export async function deleteSpace(ws: HoldsSpaces, id: string, keep = false) {
  const space = ws.spaces.find((entry) => entry.id === id)
  if (!space) return

  {
    // The account keeps a deleted space for 14 days; signed out, this device
    // keeps it in its trash folder instead (see trash.svelte.ts).
    const gone = await (
      account.signedIn && !keep
        ? invoke('delete_space', { path: space.root })
        : invoke('trash_item', { path: space.root, kind: 'space' })
    )
      .then(() => true)
      .catch(() => false)

    if (!gone) return
  }

  // Its tabs close and what was kept under its root goes with it; see
  // workspace/file-ops.ts.
  await ws.fileGone(space.root, 'space')
  ws.spaces = ws.spaces.filter((entry) => entry.id !== id)
  if (ws.activeSpaceId !== id) {
    ws.persist()
    return
  }

  ws.activeSpaceId = ws.spaces[0]?.id ?? null
  ws.tree = null
  if (ws.activeSpaceId) await selectSpace(ws, ws.activeSpaceId)
  else ws.persist()
}
