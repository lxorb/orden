/** The doubles of a device's trash: notes sync put there when another device deleted
 *  them, which the account's Recently deleted holds already (#765).
 *
 *  Sync used to put a note another device deleted in this device's trash as well as the
 *  account's, so Recently deleted listed it twice, and a reader on a fresh install found
 *  history there they never made. Sync no longer does (sync/deletes.ts); the doubles it
 *  left are taken out of this device's trash when Recently deleted is read, since the
 *  account's entry is the same note and comes back the same way.
 *
 *  Fetched with the first look at Recently deleted that has both lists to compare. */

import { sync } from './sync.svelte'
import { invoke } from './tauri'
import type { TrashItem } from './trash.svelte'
import { workspace } from './workspace.svelte'

/** A note in the account's Recently deleted, as its listing says it. */
export interface AccountNote {
  spaceId: string
  path: string
  deletedAt: number
}

/** The folder a space of the account is on this device, as the trash names it: its
 *  name in the notes folder. Null for a space this device does not hold. */
export function folderOfSpace(spaceId: string): string | null {
  const space = workspace.spaces.find((one) => sync.remoteIdFor(one.root) === spaceId)
  return space ? (space.root.split(/[\\/]/).pop() ?? null) : null
}

/** The device's entries that are a note the account's Recently deleted holds too, put in
 *  this device's trash by sync when it heard of the delete: the same note at the same
 *  place, gone from here no earlier than the account says it went. A note deleted here
 *  before the account's copy went is the reader's own, and stays. */
export function doublesOf(
  device: readonly TrashItem[],
  account: readonly AccountNote[],
  folderOf: (spaceId: string) => string | null,
): string[] {
  const gone = new Map<string, number>()
  for (const note of account) {
    const folder = folderOf(note.spaceId)
    if (folder === null) continue
    const key = `${folder}/${note.path}`.toLowerCase()
    gone.set(key, Math.min(gone.get(key) ?? Infinity, note.deletedAt))
  }
  return device
    .filter((item) => {
      if (item.kind !== 'note') return false
      const at = item.from === undefined ? undefined : gone.get(item.from.toLowerCase())
      return at !== undefined && item.deletedAt >= at
    })
    .map((item) => item.id)
}

/** The device's entries without their doubles, which are purged from this device's
 *  trash on the way. */
export async function withoutDoubles(
  device: TrashItem[],
  account: readonly AccountNote[],
): Promise<TrashItem[]> {
  const doubles = new Set(doublesOf(device, account, folderOfSpace))
  if (!doubles.size) return device
  for (const item of device) {
    if (doubles.has(item.id)) await invoke('purge_trash', { id: item.ref }).catch(() => undefined)
  }
  return device.filter((item) => !doubles.has(item.id))
}
