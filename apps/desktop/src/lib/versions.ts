/** A note's versions, wherever they are kept, as one list: what the versions sheet
 *  shows and what an agent's `list_versions` answers (docs/agent-native.md 8.5).
 *
 *  Two places keep them and the reader wants one list: the device's own, which is
 *  instant and goes back to before the note was ever synced, and the account's, which
 *  is the only one another machine can see. `by` is the device that wrote an account
 *  version, or the agent a version of this machine's was kept for, which is the whole
 *  of what a row has to say about where it came from. */

import { account } from './account.svelte'
import { api } from './api'
import { deviceName } from './device'
import { sync } from './sync.svelte'
import { invoke } from './tauri'

interface Snapshot {
  taken_at: number
  size: number
  path: string
  /** Who it was kept for when that was not a save: an agent, before its first edit
   *  of the note. See history.rs. */
  source?: string | null
}

/** One version, wherever it is kept. */
export interface Version {
  at: number
  size: number
  /** The device's handle on it, or null for one the account holds. */
  path: string | null
  by: string
}

/** How close two versions have to be to be the same one seen twice. A push follows
 *  the write that caused it by a pass at most. Only this device's own pushes are
 *  matched this way: a pass keeps a copy of the words it is about to replace at the
 *  moment another device's words arrive, so a version from elsewhere is near a local
 *  one exactly when it matters most. */
const TOGETHER = 60 * 1000

/** Both histories as one list, newest first.
 *
 *  A version the device kept and then pushed is one moment, and it is in both lists;
 *  the device's copy wins, because reading it costs nothing. Anything the account
 *  holds that this machine did not push - written on the phone, by Bob, or by a
 *  connected app - is listed in time order like any other version, however near a
 *  copy kept here it is. So is what this machine pushed before the disk was wiped. */
export async function versionsOf(path: string): Promise<Version[]> {
  const mine = await invoke<Snapshot[]>('list_snapshots', { path }).catch(() => [])
  const here: Version[] = mine.map((one) => ({
    at: one.taken_at,
    size: one.size,
    path: one.path,
    by: one.source ?? '',
  }))

  const token = account.accountToken
  const id = sync.tracked(path)?.id
  if (!token || !id) return here

  const theirs = await api.noteVersions(token, id).catch(() => ({ versions: [] }))
  const me = deviceName()
  const fromAccount = theirs.versions
    .filter((one) => one.by !== me || !here.some((ours) => Math.abs(ours.at - one.at) < TOGETHER))
    .map((one) => ({ at: one.at, size: one.size, path: null, by: one.by }))

  return [...here, ...fromAccount].sort((one, other) => other.at - one.at)
}

/** One version's words, from wherever that version is kept. The note is named as well
 *  as the version, because the browser keeps its versions in one store and the
 *  desktop keeps each note's in a folder. */
export async function versionText(version: Version, notePath: string): Promise<string> {
  if (version.path !== null) {
    return await invoke<string>('read_snapshot', { path: version.path, notePath })
  }

  const token = account.accountToken
  const id = sync.tracked(notePath)?.id
  if (!token || !id) return ''

  const said = await api.noteVersion(token, id, version.at)
  return said.content
}
