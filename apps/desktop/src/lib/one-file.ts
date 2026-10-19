/** Where a link to one note, canvas, page note or chat lands, and where a guest it
 *  landed comes back to. Fetched by joining.svelte.ts once such a link lands or a guest
 *  is back, neither of which is in front of the first paint.
 *
 *  Followed by an account that already holds the file's space - the owner following
 *  their own link on another device, or somebody in the space following one they were
 *  sent - the file opens where it is kept rather than as a borrowed tab, which is none
 *  of theirs: Shared with you does not list it, so it opened to be read, and a canvas
 *  drawn on there went to nobody (#386). Anybody else is handed it as a borrowed tab;
 *  see sharing.svelte.ts and docs/sharing.md. */

import type { SharedItem } from './api'
import { account } from './account.svelte'
import { sharedWithYou } from './sharing.svelte'
import { insideSpace, within } from './space-paths'
import { sync } from './sync.svelte'
import { waited } from './timing'
import { workspace } from './workspace.svelte'

/** How often to look again while the space is on its way, and for how long at most. */
const LOOK = 150
const PATIENCE = 20_000

/** Where this device keeps the file, when it keeps it at all: the folder mirroring its
 *  space, and the file there being that very note. */
function keptAt(item: SharedItem): string | null {
  const space = workspace.spaces.find((one) => sync.remoteIdFor(one.root) === item.space.id)
  const path = space ? insideSpace(space.root, item.path) : null
  return path && sync.tracked(path)?.id === item.id ? path : null
}

/** Opens the file where this device keeps it. Answers whether it did. */
async function openWhereKept(item: SharedItem): Promise<boolean> {
  // A guest keeps nothing here.
  if (!account.user) return false

  // The account's spaces, as of now: a link can land before the launch has listed them.
  const holds = () => account.spaces.some((one) => one.id === item.space.id)
  if (!holds()) await account.loadSpaces().catch(() => undefined)
  if (!holds()) return false

  // On a device the space has not come down to yet, the launch's pass is bringing it:
  // looked for again while it does, with a pass asked for whenever none is in the air.
  // Never while sync v2 is still being fetched: a pass asked for then is v1's.
  const until = Date.now() + PATIENCE
  let path = keptAt(item)
  while (!path && Date.now() < until) {
    if (!(sync.version === 2 && !sync.engine) && !sync.passing) await sync.pass()
    await waited(LOOK)
    path = keptAt(item)
  }
  if (!path) return false

  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  if (space) await workspace.showSpace(space.id)
  await workspace.openEntry(path)
  return true
}

/** A link to one file has let this device in: the file, where it is kept or borrowed. */
export async function landOn(item: SharedItem): Promise<void> {
  if (await openWhereKept(item)) return

  await sharedWithYou.load()
  await sharedWithYou.open(item)
}

/** A guest holding one file and no space, back. No tab of a borrowed file outlives a
 *  launch - it has no path to be kept under - so what they came back to was the app
 *  round a space of nothing, with the file one row deep in a list they never had to
 *  open. The file is what they came for, so it opens again; see alone.svelte.ts. More
 *  than one, and the list is how to choose. */
export async function backToTheFile(): Promise<void> {
  if (account.user || account.spaces.length) return

  const [only, ...more] = sharedWithYou.items
  if (only && !more.length) await sharedWithYou.open(only)
}
