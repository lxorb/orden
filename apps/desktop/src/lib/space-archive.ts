/** Putting a whole space away, and taking it back (#352): the space menu's Archive, the
 *  switcher's Archived rows, and the account hearing of both.
 *
 *  Emil: *"should be possible to archive entire spaces"*. The space keeps its folder,
 *  its files and its sync; it leaves every list of spaces and every list that reads
 *  across them (workspace/archived-spaces.svelte.ts), and taking it back puts it where it
 *  was. The space that is open is left for the one beside it first, and the last space
 *  in sight is never put away: a window has to be in some space.
 *
 *  A space the account has is put away on the account too, as the `archivedSpaces`
 *  setting - its id, per person, since a space somebody shared with you is yours to put
 *  away and still theirs to keep - so every device agrees. One only this device has is
 *  this device's. The account's list is taken at start and at every listing of the
 *  spaces, unless this device has changed it since and not yet said so, in which case
 *  this device's is sent instead.
 *
 *  Fetched with the press, and with the account's settings; nothing here is in front of
 *  the first paint. */

import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { keep, stored } from './stored'
import { type Space, workspace } from './workspace.svelte'

/** Whether this device has put a space away or back since the account last heard. */
const OWED_KEY = 'nib:archived-spaces-owed'

/** What the account said last, by space id; null until it has said anything. */
let heard: readonly string[] | null = null

/** Whether a space can be put away now: one in sight, and not the last one. */
export function canArchive(space: Space): boolean {
  const shown = workspace.shownSpaces
  return shown.length > 1 && shown.some((one) => one.id === space.id)
}

/** Puts a space away. The open one is left for the one after it in the list, or the
 *  one before at the end. */
export async function archiveSpace(space: Space): Promise<void> {
  if (!canArchive(space)) return

  if (workspace.activeSpaceId === space.id) {
    const shown = workspace.shownSpaces
    const at = shown.findIndex((one) => one.id === space.id)
    const next = shown[at + 1] ?? shown[at - 1]
    if (next) await workspace.showSpace(next.id)
  }

  if (workspace.archivedSpaces.set(space.root, true)) await tell()
}

/** Takes a space back, where it was in the list. */
export async function unarchiveSpace(space: Space): Promise<void> {
  if (workspace.archivedSpaces.set(space.root, false)) await tell()
}

/** The spaces put away, in the reader's order: the switcher's Archived rows. */
export function archivedSpaces(): Space[] {
  return workspace.spaces.filter((one) => workspace.archivedSpaces.has(one.root))
}

/** The account's list, with the account's settings: taken, unless this device owes it
 *  its own. */
export async function receive(remote: AccountSettings): Promise<void> {
  if (!Array.isArray(remote.archivedSpaces)) return
  heard = remote.archivedSpaces.filter((id): id is string => typeof id === 'string')
  await listed()
}

/** The spaces listed again: what the account said is taken, or what this device owes it
 *  is sent. */
export async function listed(): Promise<void> {
  if (stored(OWED_KEY) === true) await tell()
  else await reconcile()
}

/** Each space the account has, put away or brought back as the account last said; a
 *  space only this device has stays as it is. Never the last space in sight: where the
 *  account would put every one away, the open one stays. The open space, put away on
 *  another device, is left for one in sight. */
export async function reconcile(): Promise<void> {
  if (heard === null || stored(OWED_KEY) === true) return
  const { sync } = await import('./sync.svelte')
  const said = new Set(heard)

  for (const space of workspace.spaces) {
    const id = sync.remoteIdFor(space.root)
    if (id === null) continue
    const away = said.has(id)
    if (away && workspace.shownSpaces.length < 2 && !workspace.archivedSpaces.has(space.root)) {
      continue
    }
    workspace.archivedSpaces.set(space.root, away)
  }

  const open = workspace.activeSpace
  if (open && workspace.archivedSpaces.has(open.root)) {
    const next = workspace.shownSpaces[0]
    if (next) await workspace.showSpace(next.id)
    else workspace.archivedSpaces.set(open.root, false)
  }
}

/** Tells the account which of its spaces are put away. Owed until it has heard, so a
 *  change made offline is sent at the next chance rather than undone by an older list. */
async function tell(): Promise<void> {
  const token = account.accountToken
  if (!token) return
  keep(OWED_KEY, 'true')

  const { sync } = await import('./sync.svelte')
  const idOf = (space: Space) => sync.remoteIdFor(space.root)
  const known = new Set(workspace.spaces.map(idOf))
  // What the account holds of spaces this device does not have stays as it said.
  const theirs = (heard ?? []).filter((id) => !known.has(id))
  const ids = [
    ...theirs,
    ...archivedSpaces()
      .map(idOf)
      .filter((id): id is string => id !== null),
  ]
  try {
    await api.saveSettings(token, { archivedSpaces: ids })
    heard = ids
    keep(OWED_KEY, 'false')
  } catch {
    // Still owed; the next start or listing sends it.
  }
}
