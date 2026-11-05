/** The profiles Zen lists on this machine, and one of them's sidebar.
 *
 *  The crate lists them out of Zen's own `profiles.ini` and hands over the bytes of
 *  a session file it has judged to be one of theirs, and what `places.sqlite` holds;
 *  see zen_profiles.rs. The unpacking and the reading are here, so they are pure
 *  functions a test holds. Desktop only: everywhere else there is no Zen to read. */

import { fromBase64 } from '../bytes'
import { t } from '../i18n.svelte'
import { invoke, isDesktop } from '../tauri'
import { unmozLz4 } from './mozlz4'
import { type BrowserEngine, mozillaEngine } from './search-engines'
import type { FolderWords } from './sidebar-made'
import { readZenSession, withBookmarks, type ZenPlaces, type ZenSession } from './zen'

export interface ZenProfile {
  name: string
  path: string
  /** The session files the profile holds, the one to read first in front. */
  files: string[]
}

/** The one Zen opens first in front. None off the desktop or where Zen never ran. */
export async function zenProfiles(): Promise<ZenProfile[]> {
  if (!isDesktop) return []
  try {
    return await invoke<ZenProfile[]>('zen_profiles')
  } catch {
    return []
  }
}

/** What a profile brings: its sidebar with its bookmarks, and its search engine. */
export interface ZenRead {
  sidebar: ZenSession
  engine: BrowserEngine | null
}

/** The search engines' file, which is Firefox's. */
const SEARCH = 'search.json.mozlz4'

/** The profile's sidebar, out of the first of its session files that holds one: Zen's
 *  own file, then its backups, then Firefox's session, which carries the same lists. A
 *  file Zen was halfway through writing is a file to step past, not a refusal. */
export async function zenSession(profile: ZenProfile, words: FolderWords): Promise<ZenRead> {
  const places = profile.files.includes('places.sqlite') ? await placesOf(profile) : null
  for (const file of profile.files.filter((one) => one.includes('session'))) {
    const session = await fileOf(profile, file)
      .then((said) => readZenSession(said, places))
      .catch(() => null)
    if (session) {
      const engine = profile.files.includes(SEARCH)
        ? mozillaEngine(await fileOf(profile, SEARCH).catch(() => null))
        : null
      return { sidebar: withBookmarks(session, places, words), engine }
    }
  }

  throw new Error(t('Zen’s tabs could not be read.'))
}

/** What one `.jsonlz4` of the profile holds. */
async function fileOf(profile: ZenProfile, file: string): Promise<unknown> {
  const said = await invoke<string>('read_zen_file', { profile: profile.path, file })
  return JSON.parse(new TextDecoder().decode(unmozLz4(fromBase64(said)))) as unknown
}

/** What `places.sqlite` holds, or null where it could not be read. */
async function placesOf(profile: ZenProfile): Promise<ZenPlaces | null> {
  try {
    const said = JSON.parse(
      await invoke<string>('read_zen_places', { profile: profile.path }),
    ) as Partial<ZenPlaces>
    return {
      spaces: Array.isArray(said.spaces) ? said.spaces : [],
      pins: Array.isArray(said.pins) ? said.pins : [],
      bookmarks: said.bookmarks ?? null,
      assigned: Array.isArray(said.assigned) ? said.assigned : [],
    }
  } catch {
    return null
  }
}
